import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.schemas.health import HealthResponse

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Health"])


@router.get("/health", response_model=HealthResponse)
def health(session: Annotated[Session, Depends(get_session)]) -> HealthResponse:
    try:
        session.execute(text("SELECT 1"))
    except SQLAlchemyError as error:
        logger.exception("Database health check failed")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Veritabanı bağlantısı kullanılamıyor.",
        ) from error
    return HealthResponse()
