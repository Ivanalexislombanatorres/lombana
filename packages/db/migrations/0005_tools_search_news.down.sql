do $$
begin
  execute format('grant temporary on database %I to public', current_database());
end
$$;
drop view if exists public.news_published_contributions;
drop table if exists public.news_contributions;
drop function if exists app.guard_contribution_status();
drop table if exists public.news_items;
drop table if exists public.news_sources;
drop table if exists public.search_documents;
drop table if exists public.tool_runs;
drop table if exists public.tools;
