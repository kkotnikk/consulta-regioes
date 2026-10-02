-- Corrige a checagem de órfãos: a RLS do remetente ocultava o vínculo do destinatário.
create function consulta_regioes_private.pdf_lote_sem_vinculo(caminho text)
returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.relatorios_por_rota r where r.arquivo_path=caminho);
$$;
revoke all on function consulta_regioes_private.pdf_lote_sem_vinculo(text) from public,anon;
grant execute on function consulta_regioes_private.pdf_lote_sem_vinculo(text) to authenticated;
alter policy relatorio_lote_pdf_limpeza_leitura on storage.objects
 using(bucket_id='relatorios' and owner_id=(select auth.uid())::text
 and consulta_regioes_private.usuario_pode_distribuir_pdf(name)
 and consulta_regioes_private.pdf_lote_sem_vinculo(name));
alter policy relatorio_lote_pdf_limpeza on storage.objects
 using(bucket_id='relatorios' and owner_id=(select auth.uid())::text
 and consulta_regioes_private.usuario_pode_distribuir_pdf(name)
 and consulta_regioes_private.pdf_lote_sem_vinculo(name));
