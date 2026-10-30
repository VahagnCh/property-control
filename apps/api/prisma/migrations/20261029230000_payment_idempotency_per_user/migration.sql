-- A payment idempotency key is unique per recorder, not for the whole property.
DROP INDEX IF EXISTS "payments_property_id_idempotency_key_key";
CREATE UNIQUE INDEX "payments_property_user_idempotency_key"
  ON "payments" ("property_id", "recorded_by_user_id", "idempotency_key");
