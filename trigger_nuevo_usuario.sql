-- ==============================================================================
-- TRIGGER PARA CREAR EL PERFIL DE HERMANO AUTOMÁTICAMENTE AL REGISTRARSE
-- Ejecutá esto en el SQL Editor de Supabase
-- ==============================================================================

-- 1. Creamos la función que se va a ejecutar cuando un usuario nuevo se registre
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  -- Insertamos el registro en public.usuarios
  INSERT INTO public.usuarios (
    id, 
    email, 
    nombre, 
    rol, 
    rol_especifico,
    permisos, 
    etiquetas, 
    ausencias, 
    grupo, 
    bautizado, 
    tipo_precursor
  )
  VALUES (
    new.id, -- El mismo UUID de auth.users
    new.email, 
    -- Si no hay un nombre configurado, usamos la parte antes del @ del email temporalmente
    COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)), 
    'hermano', -- Rol por defecto solicitado
    '',
    '[]'::jsonb, -- Sin permisos por defecto
    '[]'::jsonb,
    '[]'::jsonb,
    '',
    false,
    ''
  );
  
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Borramos el trigger si ya existía para evitar duplicados
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- 3. Creamos el trigger que "escucha" a la tabla auth.users
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
