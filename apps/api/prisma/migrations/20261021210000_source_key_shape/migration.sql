-- Trust rev f.5. source_key is {env}/evidence/{uuid} or {env}/documents/{uuid}.
-- env is staging or prod. The key has no property id. Ownership stays on the row.
-- OCR jobs store the document key the stub builds.

ALTER TABLE evidence
  DROP CONSTRAINT IF EXISTS evidence_source_key_shape;
ALTER TABLE evidence
  ADD CONSTRAINT evidence_source_key_shape CHECK (
    source_key ~ '^(staging|prod)/evidence/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );

ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_source_key_shape;
ALTER TABLE documents
  ADD CONSTRAINT documents_source_key_shape CHECK (
    source_key ~ '^(staging|prod)/documents/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );

ALTER TABLE ocr_jobs
  DROP CONSTRAINT IF EXISTS ocr_jobs_source_key_shape;
ALTER TABLE ocr_jobs
  ADD CONSTRAINT ocr_jobs_source_key_shape CHECK (
    source_key ~ '^(staging|prod)/documents/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );
