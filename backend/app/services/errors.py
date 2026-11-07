class NotFoundError(ValueError):
    """The requested dataset or live feature does not exist."""


class RevisionConflictError(ValueError):
    """The dataset changed after the caller read it."""
