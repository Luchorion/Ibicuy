-- Esquema SQL para la Congregación App
-- Ejecutar en el Editor SQL de Supabase

-- 1. Tabla de Usuarios (Hermanos)
CREATE TABLE public.usuarios (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    nombre TEXT NOT NULL,
    rol TEXT DEFAULT 'publicador',
    rol_especifico TEXT DEFAULT '',
    etiquetas JSONB DEFAULT '[]'::jsonb,
    permisos JSONB DEFAULT '[]'::jsonb,
    ausencias JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Tabla de Territorios
CREATE TABLE public.territorios (
    id TEXT PRIMARY KEY, -- Ej: 'T123456789'
    numero TEXT NOT NULL,
    descripcion TEXT,
    notas TEXT,
    puntos_encuentro TEXT,
    asignado_a UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
    manzanas JSONB DEFAULT '[]'::jsonb,
    historial JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Tabla de Reuniones (Por semana)
CREATE TABLE public.reuniones (
    id TEXT PRIMARY KEY, -- Ej: '2026-W20'
    entre JSONB DEFAULT '{}'::jsonb,
    fin JSONB DEFAULT '{}'::jsonb,
    tareas JSONB DEFAULT '{}'::jsonb,
    asistencia JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Tabla de Eventos
CREATE TABLE public.eventos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre TEXT NOT NULL,
    descripcion TEXT,
    fecha DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Tabla de Anuncios (Tablero)
CREATE TABLE public.anuncios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    texto TEXT NOT NULL,
    imagen TEXT,
    fecha TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. Tabla de Informes Mensuales (Actividad)
CREATE TABLE public.informes_mensuales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.usuarios(id) ON DELETE CASCADE,
    fecha TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    horas NUMERIC DEFAULT 0,
    estudios INTEGER DEFAULT 0
);

-- 7. Tabla de Solicitudes (Exhibidores)
CREATE TABLE public.solicitudes_exhibidores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.usuarios(id) ON DELETE CASCADE,
    dia TEXT NOT NULL,
    lugar TEXT NOT NULL,
    estado TEXT DEFAULT 'pendiente'
);

-- 8. Tabla de Oradores Visitantes
CREATE TABLE public.oradores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre TEXT NOT NULL,
    congregacion TEXT,
    telefono TEXT,
    bosquejos JSONB DEFAULT '[]'::jsonb,
    historial JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Habilitar RLS (Row Level Security) para mayor seguridad, por ahora permitimos todo para facilitar el desarrollo,
-- pero se recomienda ajustarlo más adelante.
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.territorios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reuniones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anuncios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.informes_mensuales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solicitudes_exhibidores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oradores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all public" ON public.usuarios FOR ALL USING (true);
CREATE POLICY "Allow all public" ON public.territorios FOR ALL USING (true);
CREATE POLICY "Allow all public" ON public.reuniones FOR ALL USING (true);
CREATE POLICY "Allow all public" ON public.eventos FOR ALL USING (true);
CREATE POLICY "Allow all public" ON public.anuncios FOR ALL USING (true);
CREATE POLICY "Allow all public" ON public.informes_mensuales FOR ALL USING (true);
CREATE POLICY "Allow all public" ON public.solicitudes_exhibidores FOR ALL USING (true);
CREATE POLICY "Allow all public" ON public.oradores FOR ALL USING (true);
