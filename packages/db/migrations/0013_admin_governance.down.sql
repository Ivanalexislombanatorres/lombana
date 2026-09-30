drop function if exists app.admin_set_min_price(bigint);
drop function if exists app.admin_audit(int);
drop function if exists app.admin_set_platform_role(uuid, text, boolean);
drop function if exists app.admin_set_user_status(uuid, text, text);
drop function if exists app.admin_list_users(text, int);
drop function if exists app.admin_overview();
drop function if exists app.my_platform_permissions();
drop function if exists app.require_platform_permission(text);
