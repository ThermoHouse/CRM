-- Ventas puede crear y editar sus propios reportes técnicos de garantía.
drop policy if exists warranty_reports_insert on public.warranty_reports;
create policy warranty_reports_insert on public.warranty_reports
  for insert to authenticated
  with check (
    public.current_user_role() in ('root','administrative','sales')
    and created_by = (select auth.uid())
  );

drop policy if exists warranty_reports_update on public.warranty_reports;
create policy warranty_reports_update on public.warranty_reports
  for update to authenticated
  using (
    public.current_user_role() in ('root','administrative')
    or (
      public.current_user_role() = 'sales'
      and created_by = (select auth.uid())
    )
  )
  with check (
    public.current_user_role() in ('root','administrative')
    or (
      public.current_user_role() = 'sales'
      and created_by = (select auth.uid())
    )
  );

drop policy if exists warranty_reports_storage_insert on storage.objects;
create policy warranty_reports_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'warranty-reports'
    and exists (
      select 1
      from public.warranty_reports as report
      where report.id::text = (storage.foldername(name))[1]
        and (
          public.current_user_role() in ('root','administrative')
          or (
            public.current_user_role() = 'sales'
            and report.created_by = (select auth.uid())
          )
        )
    )
  );

drop policy if exists warranty_reports_storage_update on storage.objects;
create policy warranty_reports_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'warranty-reports'
    and exists (
      select 1
      from public.warranty_reports as report
      where report.id::text = (storage.foldername(name))[1]
        and (
          public.current_user_role() in ('root','administrative')
          or (
            public.current_user_role() = 'sales'
            and report.created_by = (select auth.uid())
          )
        )
    )
  )
  with check (
    bucket_id = 'warranty-reports'
    and exists (
      select 1
      from public.warranty_reports as report
      where report.id::text = (storage.foldername(name))[1]
        and (
          public.current_user_role() in ('root','administrative')
          or (
            public.current_user_role() = 'sales'
            and report.created_by = (select auth.uid())
          )
        )
    )
  );

drop policy if exists warranty_reports_storage_delete on storage.objects;
create policy warranty_reports_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'warranty-reports'
    and exists (
      select 1
      from public.warranty_reports as report
      where report.id::text = (storage.foldername(name))[1]
        and (
          public.current_user_role() in ('root','administrative')
          or (
            public.current_user_role() = 'sales'
            and report.created_by = (select auth.uid())
          )
        )
    )
  );

-- Administrativo y root pueden eliminar movimientos directamente desde el libro.
drop policy if exists movimientos_financieros_delete on public.movimientos_financieros;
create policy movimientos_financieros_delete on public.movimientos_financieros
  for delete to authenticated
  using (public.current_user_role() in ('root','administrative'));

drop policy if exists comprobantes_delete on storage.objects;
create policy comprobantes_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'comprobantes'
    and public.current_user_role() in ('root','administrative')
  );
