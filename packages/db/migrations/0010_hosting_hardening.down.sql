-- Los privilegios retirados a roles de terceros no se restauran: volver a abrir
-- acceso a anon/authenticated sería una decisión explícita, no un rollback.
-- La membresía en lombana_privileged se conserva (no daña y otras bases del
-- clúster pueden necesitarla).
select 1;
