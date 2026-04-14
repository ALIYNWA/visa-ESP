"""Core eligibility engine — orchestrates LLM call, validation, scoring."""
import json
import uuid
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.core.security import decrypt_data, encrypt_data, hash_prompt
from app.models.analysis import Analysis, CriterionResult
from app.models.criterion import Criterion
from app.models.patient import Patient
from app.models.protocol import Protocol
from app.schemas.llm import LLMAnalysisOutput
from app.services.audit_service import AuditService
from app.services.llm_service import LLMService, LLMServiceError
from app.services.prompt_builder import build_eligibility_prompt

logger = get_logger(__name__)


class EligibilityEngine:
    def __init__(self, llm_service: LLMService, audit_service: AuditService) -> None:
        self._llm = llm_service
        self._audit = audit_service

    async def run_analysis(
        self,
        db: AsyncSession,
        protocol: Protocol,
        criteria: list[Criterion],
        patient: Patient,
        current_user_id: uuid.UUID,
        ip_address: str = "",
    ) -> Analysis:
        """
        Run eligibility analysis for a patient against a protocol.
        Returns the persisted Analysis.
        """
        # Décrypter le contexte patient
        patient_context = self._decrypt_patient_context(patient)

        # Construire le prompt
        prompt = build_eligibility_prompt(protocol, criteria, patient_context)
        prompt_hash = hash_prompt(prompt)

        logger.info(
            "eligibility_analysis_start",
            protocol_id=str(protocol.id),
            patient_id=str(patient.id),
            prompt_hash=prompt_hash,
            criteria_count=len(criteria),
        )

        # Appel LLM avec retry
        llm_output, raw_response, latency_ms = await self._llm.analyze(prompt)

        # Validation côté serveur : vérifier les criterion_id
        criterion_ids = {str(c.id) for c in criteria}
        llm_output = self._validate_criterion_ids(llm_output, criterion_ids)

        # Recalculer le score côté serveur (ne pas faire confiance au LLM)
        server_score, server_verdict = self._compute_score_and_verdict(llm_output, criteria)

        # Chiffrer la réponse brute LLM
        encrypted_raw = encrypt_data(raw_response)

        # Récupérer la version du modèle
        model_info = await self._llm.get_model_info()
        model_version = model_info.get("details", {}).get("parameter_size", "unknown")

        # Créer l'analyse
        analysis = Analysis(
            id=uuid.uuid4(),
            protocol_id=protocol.id,
            protocol_version=protocol.version,
            patient_id=patient.id,
            verdict=server_verdict,
            score_pct=server_score,
            resume=llm_output.resume,
            points_attention=llm_output.points_attention,
            prompt_hash=prompt_hash,
            model_name=from_settings_model(),
            model_version=model_version,
            raw_llm_response_encrypted=encrypted_raw,
            latency_ms=latency_ms,
            created_by=current_user_id,
        )
        db.add(analysis)
        await db.flush()  # Obtenir l'ID

        # Créer les résultats par critère
        criterion_map = {str(c.id): c for c in criteria}
        for llm_crit in llm_output.criteres:
            criterion = criterion_map.get(llm_crit.criterion_id)
            if not criterion:
                continue
            cr = CriterionResult(
                id=uuid.uuid4(),
                analysis_id=analysis.id,
                criterion_id=criterion.id,
                criterion_text=criterion.text,
                criterion_type=criterion.type,
                status=llm_crit.statut,
                reasoning=llm_crit.raisonnement,
            )
            db.add(cr)

        await db.flush()

        # Log audit (sans données patient — uniquement UUIDs)
        await self._audit.log(
            db=db,
            event_type="analysis_created",
            user_id=current_user_id,
            resource_type="analysis",
            resource_id=analysis.id,
            details={
                "protocol_id": str(protocol.id),
                "patient_id": str(patient.id),
                "verdict": server_verdict,
                "score_pct": server_score,
                "latency_ms": latency_ms,
            },
            ip_address=ip_address,
        )

        logger.info(
            "eligibility_analysis_complete",
            analysis_id=str(analysis.id),
            verdict=server_verdict,
            score_pct=server_score,
            latency_ms=latency_ms,
        )

        return analysis

    def _decrypt_patient_context(self, patient: Patient) -> dict:
        """Déchiffrer le contexte patient."""
        if not patient.context_encrypted:
            return {}
        try:
            return json.loads(decrypt_data(patient.context_encrypted))
        except Exception as exc:
            logger.error("patient_context_decryption_failed", patient_id=str(patient.id), error=str(exc))
            return {}

    def _validate_criterion_ids(
        self,
        output: LLMAnalysisOutput,
        expected_ids: set[str],
    ) -> LLMAnalysisOutput:
        """Vérifier que les criterion_id du LLM correspondent aux critères envoyés."""
        valid_criteres = []
        for cr in output.criteres:
            if cr.criterion_id in expected_ids:
                valid_criteres.append(cr)
            else:
                logger.warning(
                    "llm_unknown_criterion_id",
                    criterion_id=cr.criterion_id,
                )

        # Vérifier les critères manquants
        returned_ids = {cr.criterion_id for cr in output.criteres}
        missing_ids = expected_ids - returned_ids
        if missing_ids:
            logger.warning("llm_missing_criteria", missing_count=len(missing_ids))

        return output.model_copy(update={"criteres": valid_criteres})

    def _compute_score_and_verdict(
        self,
        output: LLMAnalysisOutput,
        criteria: list[Criterion],
    ) -> tuple[int, str]:
        """
        Recalculer le score et le verdict côté serveur.
        Ne pas faire confiance aux valeurs du LLM.
        """
        if not criteria:
            return 100, "eligible"

        criterion_status = {str(cr.criterion_id): cr.statut for cr in output.criteres}

        inc_criteria = [c for c in criteria if c.type == "INC"]
        exc_criteria = [c for c in criteria if c.type == "EXC"]

        inc_satisfied = sum(
            1 for c in inc_criteria
            if criterion_status.get(str(c.id)) == "satisfait"
        )
        exc_satisfied = sum(
            1 for c in exc_criteria
            if criterion_status.get(str(c.id)) == "satisfait"
        )

        has_non_satisfait = any(
            criterion_status.get(str(c.id)) == "non_satisfait"
            for c in criteria
        )
        has_unknown = any(
            criterion_status.get(str(c.id)) == "inconnu"
            for c in criteria
        )

        # Score : (critères INC satisfaits + critères EXC satisfaits) / total
        total = len(criteria)
        satisfied_count = inc_satisfied + exc_satisfied
        server_score = int(round((satisfied_count / total) * 100)) if total > 0 else 100

        # Verdict
        if has_non_satisfait:
            verdict = "non_eligible"
        elif has_unknown:
            verdict = "incomplet"
        else:
            verdict = "eligible"

        return server_score, verdict


def from_settings_model() -> str:
    from app.core.config import settings
    return settings.OLLAMA_MODEL
