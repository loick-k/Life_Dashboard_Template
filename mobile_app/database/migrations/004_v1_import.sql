CREATE TABLE v1_import_runs (
 source_id TEXT PRIMARY KEY, payload_sha256 TEXT NOT NULL, imported_at TEXT NOT NULL
);
CREATE TABLE v1_import_archive (
 source_id TEXT NOT NULL, source_table TEXT NOT NULL, source_row_key TEXT NOT NULL,
 payload_json TEXT NOT NULL,
 PRIMARY KEY (source_id, source_table, source_row_key),
 FOREIGN KEY (source_id) REFERENCES v1_import_runs(source_id) ON DELETE CASCADE
);
