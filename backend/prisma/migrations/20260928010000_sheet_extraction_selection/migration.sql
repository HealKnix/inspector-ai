-- Historical whole-document results remain NULL and are never rewritten.
ALTER TABLE "extractions" ADD COLUMN "selection_key" VARCHAR(64);
