-- Publishing an aviso version is owner-only. The app role can still
-- insert a person's acceptance into consents.
REVOKE INSERT ON TABLE aviso_versions FROM property_control_app;
