-- Normalización de teléfonos argentinos al formato de WhatsApp (549 + 10 dígitos).
-- Misma lógica que js/telefono.js; ambas se prueban con tests/casos-telefono.json.
-- Devuelve null si el número no es válido. Es immutable: depende solo de los argumentos.
create or replace function app.normalizar_telefono(texto text, codigo_area text)
returns text
language plpgsql
immutable
as $$
declare
  d text := regexp_replace(coalesce(texto, ''), '[^0-9]', '', 'g');
  area text := regexp_replace(coalesce(codigo_area, ''), '[^0-9]', '', 'g');
  n int;
begin
  if d like '00%' then d := substr(d, 3); end if;
  if d like '54%' then
    d := substr(d, 3);
    if d like '9%' then d := substr(d, 2); end if;
  elsif d like '0%' then
    d := substr(d, 2);
  end if;

  -- 12 dígitos: sobra un "15" justo después del código de área (2 dígitos si es 11;
  -- si no, 3 y después 4).
  if length(d) = 12 then
    foreach n in array (case when d like '11%' then array[2] else array[3, 4] end) loop
      if substr(d, n + 1, 2) = '15' then
        d := substr(d, 1, n) || substr(d, n + 3);
        exit;
      end if;
    end loop;
  end if;

  -- Ningún código de área empieza con 15: es el prefijo de celular.
  if d like '15%' then d := substr(d, 3); end if;
  if length(d) < 10 and length(area) + length(d) = 10 then d := area || d; end if;

  if length(d) = 10 and (d ~ '^[2-9]' or d like '11%') then
    return '549' || d;
  end if;
  return null;
end;
$$;
