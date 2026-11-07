"""Add persistent import jobs and collection metadata

Revision ID: 0002_import_jobs
Revises: 0001_data_models
Create Date: 2026-11-06 10:36:30.348057
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = '0002_import_jobs'
down_revision: str | Sequence[str] | None = '0001_data_models'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Additive migration: preserve existing rows and the 0001 schema history.
    op.create_table('jobs',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('workspace_id', sa.String(length=36), nullable=False),
    sa.Column('kind', sa.String(length=16), server_default='import', nullable=False),
    sa.Column('status', sa.String(length=16), server_default='uploading', nullable=False),
    sa.Column('filename', sa.String(), nullable=False),
    sa.Column('total_bytes', sa.Integer(), server_default='0', nullable=False),
    sa.Column('received_bytes', sa.Integer(), server_default='0', nullable=False),
    sa.Column('uploaded_bytes', sa.Integer(), server_default='0', nullable=False),
    sa.Column('processed_bytes', sa.Integer(), server_default='0', nullable=False),
    sa.Column('processed_features', sa.Integer(), server_default='0', nullable=False),
    sa.Column('disk_reservation', sa.Integer(), server_default='0', nullable=False),
    sa.Column('cancel_requested', sa.Boolean(), server_default='0', nullable=False),
    sa.Column('cleanup_pending', sa.Boolean(), server_default='0', nullable=False),
    sa.Column('staging_dataset_id', sa.String(length=36), nullable=True),
    sa.Column('retired_dataset_id', sa.String(length=36), nullable=True),
    sa.Column('initial_dataset_id', sa.String(length=36), nullable=False),
    sa.Column('initial_generation_id', sa.String(length=36), nullable=False),
    sa.Column('initial_revision', sa.Integer(), nullable=False),
    sa.Column('upload_token', sa.String(length=36), nullable=True),
    sa.Column('worker_token', sa.String(length=36), nullable=True),
    sa.Column('lease_expires_at', sa.DateTime(), nullable=True),
    sa.Column('progress_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('started_at', sa.DateTime(), nullable=True),
    sa.Column('finished_at', sa.DateTime(), nullable=True),
    sa.Column('activated_at', sa.DateTime(), nullable=True),
    sa.Column('error', sa.String(), nullable=True),
    sa.Column('warning_count', sa.Integer(), server_default='0', nullable=False),
    sa.Column('invalid_features', sa.Integer(), server_default='0', nullable=False),
    sa.Column('warning_samples', sa.JSON(), server_default='[]', nullable=False),
    sa.Column('peak_rss_bytes', sa.Integer(), server_default='0', nullable=False),
    sa.CheckConstraint("status IN ('uploading','queued','running','completed','failed','cancelled')", name=op.f('ck_jobs_status_values')),
    sa.CheckConstraint('processed_features >= 0 AND disk_reservation >= 0', name=op.f('ck_jobs_counters_nonnegative')),
    sa.CheckConstraint('total_bytes >= 0 AND processed_bytes >= 0 AND processed_bytes <= total_bytes', name=op.f('ck_jobs_byte_progress')),
    sa.ForeignKeyConstraint(['staging_dataset_id'], ['datasets.id'], name=op.f('fk_jobs_staging_dataset_id_datasets'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], name=op.f('fk_jobs_workspace_id_workspaces'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_jobs'))
    )
    with op.batch_alter_table('jobs', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_jobs_staging_dataset_id'), ['staging_dataset_id'], unique=False)
        batch_op.create_index('ix_jobs_status_created', ['status', 'created_at'], unique=False)
        batch_op.create_index('ix_jobs_status_lease', ['status', 'lease_expires_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_jobs_workspace_id'), ['workspace_id'], unique=False)

    with op.batch_alter_table('datasets', schema=None) as batch_op:
        batch_op.add_column(sa.Column('metadata_json', sa.JSON(), server_default='{}', nullable=False))



def downgrade() -> None:
    with op.batch_alter_table('jobs', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_jobs_workspace_id'))
        batch_op.drop_index('ix_jobs_status_lease')
        batch_op.drop_index('ix_jobs_status_created')
        batch_op.drop_index(batch_op.f('ix_jobs_staging_dataset_id'))

    op.drop_table('jobs')
    # SQLite >=3.35 supports native DROP COLUMN. Avoid rebuilding a referenced
    # datasets table with foreign_keys enabled. Development uses SQLite 3.49.
    op.drop_column('datasets', 'metadata_json')
