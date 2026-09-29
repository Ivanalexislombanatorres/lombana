drop function if exists app.product_review_note(uuid);
drop function if exists app.review_product(uuid, text, text);
drop function if exists app.moderate_contribution(uuid, text, text);
drop function if exists app.moderation_queue();
drop function if exists app.require_moderator();
drop function if exists app.has_platform_permission(text);
