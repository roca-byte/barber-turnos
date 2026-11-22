-- Pruebas del esquema: restricciones de exclusión y de chequeo, y el reloj de las pruebas.
-- Cada archivo corre en su propia base (clon de la plantilla), así que no hace falta limpiar.

insert into barberias (id, slug, nombre)
values ('00000000-0000-0000-0000-000000000001', 'prueba', 'Barbería de prueba');
insert into barberos (id, barberia_id, nombre)
values ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Barbero');
insert into servicios (id, barberia_id, nombre, duracion_min)
values ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Corte', 30);

-- Dos turnos confirmados que se pisan: Postgres tiene que rechazar el segundo.
do $$
begin
  insert into turnos (barberia_id, barbero_id, servicio_id, inicio, fin, estado, origen, nombre_manual)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002',
          '00000000-0000-0000-0000-000000000003',
          '2026-12-01 10:00-03', '2026-12-01 10:30-03', 'confirmado', 'manual', 'A');
  begin
    insert into turnos (barberia_id, barbero_id, servicio_id, inicio, fin, estado, origen, nombre_manual)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002',
            '00000000-0000-0000-0000-000000000003',
            '2026-12-01 10:15-03', '2026-12-01 10:45-03', 'confirmado', 'manual', 'B');
    assert false, 'el turno que se pisa debía ser rechazado';
  exception when exclusion_violation then
    null; -- esperado
  end;
end $$;

-- El mismo horario pero cancelado no cuenta para la exclusión.
do $$
begin
  insert into turnos (barberia_id, barbero_id, servicio_id, inicio, fin, estado, origen, nombre_manual)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002',
          '00000000-0000-0000-0000-000000000003',
          '2026-12-01 10:15-03', '2026-12-01 10:45-03', 'cancelado', 'manual', 'B');
end $$;

-- Turnos que solo se tocan (10:00-10:30 y 10:30-11:00): tstzrange es [) y no se pisan.
do $$
begin
  insert into turnos (barberia_id, barbero_id, servicio_id, inicio, fin, estado, origen, nombre_manual)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002',
          '00000000-0000-0000-0000-000000000003',
          '2026-12-01 10:30-03', '2026-12-01 11:00-03', 'confirmado', 'manual', 'C');
  assert (select count(*) from turnos where estado = 'confirmado') = 2,
    'debían quedar 2 turnos confirmados que se tocan';
end $$;

-- Horario vacío (hasta = desde) no es válido.
do $$
begin
  begin
    insert into horarios (barberia_id, barbero_id, dia_semana, desde, hasta)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002',
            1, '09:00', '09:00');
    assert false, 'el horario con hasta = desde debía ser rechazado';
  exception when check_violation then
    null;
  end;
end $$;

-- Turno de duración cero tampoco.
do $$
begin
  begin
    insert into turnos (barberia_id, barbero_id, servicio_id, inicio, fin, estado, origen, nombre_manual)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002',
            '00000000-0000-0000-0000-000000000003',
            '2026-12-02 10:00-03', '2026-12-02 10:00-03', 'confirmado', 'manual', 'D');
    assert false, 'el turno con fin = inicio debía ser rechazado';
  exception when check_violation then
    null;
  end;
end $$;

-- El reloj de las pruebas: app.ahora() obedece a la variable app.ahora.
set app.ahora = '2026-12-01 12:00-03';
do $$
begin
  assert app.ahora() = '2026-12-01 15:00Z'::timestamptz,
    'app.ahora() debía devolver el reloj fijado: ' || app.ahora();
end $$;
reset app.ahora;
do $$
begin
  assert abs(extract(epoch from now() - app.ahora())) < 5, 'sin fijar, app.ahora() debía ser now()';
end $$;
