drop function if exists app.forbid_mutation();
drop function if exists app.touch_updated_at();
drop function if exists app.set_context(uuid, uuid);
drop function if exists app.current_org_id();
drop function if exists app.current_user_id();
drop function if exists app.is_privileged();
drop schema if exists app;
revoke usage on schema public from lombana_app;
-- El rol lombana_app y las extensiones se conservan: son objetos del clúster
-- que otras bases pueden usar. Se eliminan a mano si se desea.
