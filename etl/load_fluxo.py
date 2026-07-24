"""
load_fluxo.py
-------------
Carrega FLUXO_ENTRADA.csv no Neon e cria as views de Acompanhamento.
Idempotente — pode ser re-executado semanalmente.
"""
import csv, os, re, sys
from pathlib import Path
from dotenv import load_dotenv

try:
    import psycopg2
    from psycopg2.extras import execute_values
except ImportError:
    print("ERRO: pip install psycopg2-binary python-dotenv")
    sys.exit(1)

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")
DATABASE_URL = os.getenv("DATABASE_URL")
BASE_DIR = Path(__file__).resolve().parent.parent / "data"

# Mapa de meses em portugues -> numero
MESES_PT = {
    'jan': 1, 'fev': 2, 'mar': 3, 'abr': 4, 'mai': 5, 'jun': 6,
    'jul': 7, 'ago': 8, 'set': 9, 'out': 10, 'nov': 11, 'dez': 12
}

def parse_data(s):
    """Converte '03/nov/23' ou '01/12/2024' para date string 'YYYY-MM-DD'."""
    s = s.strip()
    if not s:
        return None
    partes = s.split('/')
    if len(partes) != 3:
        return None
    dia, mes_str, ano_str = partes
    # Mes pode ser numero ou abreviacao em pt
    if mes_str.isdigit():
        mes = int(mes_str)
    else:
        mes = MESES_PT.get(mes_str.lower()[:3], 0)
    if mes == 0:
        return None
    ano = int(ano_str)
    if ano < 100:
        ano += 2000
    try:
        return f"{ano:04d}-{mes:02d}-{int(dia):02d}"
    except:
        return None

def parse_brl(s):
    """Converte 'R$ 100.000,' para float 100000.0"""
    s = re.sub(r'[R$\s]', '', s.strip())
    s = s.replace('.', '').replace(',', '.')
    try:
        return float(s) if s else None
    except:
        return None

# ── DDL ──────────────────────────────────────────────────────────
DDL = """
CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS analytics;

DROP TABLE IF EXISTS raw.fluxo_entrada CASCADE;
CREATE TABLE raw.fluxo_entrada (
    id                      SERIAL PRIMARY KEY,
    centro_custo            TEXT,
    empreendimento          TEXT,
    investidor              TEXT,
    titulo                  TEXT,
    numero_cliente          TEXT,
    tipo_investimento       TEXT,
    possibilidade_conversao TEXT,
    status                  TEXT,
    data_pagamento_raw      TEXT,
    data_pagamento          DATE,
    realizado               NUMERIC,
    a_realizar              NUMERIC,
    carregado_em            TIMESTAMPTZ DEFAULT NOW()
);
"""

VIEW_RECEITA = """
DROP VIEW IF EXISTS analytics.v_receita_acumulada CASCADE;

CREATE VIEW analytics.v_receita_acumulada AS
WITH mensal AS (
    SELECT
        EXTRACT(YEAR  FROM data_pagamento)::INT  AS ano,
        EXTRACT(MONTH FROM data_pagamento)::INT  AS mes,
        empreendimento,
        investidor,
        SUM(COALESCE(realizado, 0))              AS receita_mes,
        SUM(COALESCE(a_realizar, 0))             AS a_realizar_mes
    FROM raw.fluxo_entrada
    WHERE data_pagamento IS NOT NULL
      AND status NOT IN ('DEVOLVIDO C/CORRECAO', 'DEVOLVIDO C/CORREÇÃO')
    GROUP BY 1, 2, 3, 4
),
acumulado AS (
    SELECT
        ano, mes, empreendimento, investidor,
        receita_mes, a_realizar_mes,
        SUM(receita_mes) OVER (
            PARTITION BY empreendimento, investidor
            ORDER BY ano, mes
            ROWS UNBOUNDED PRECEDING
        ) AS receita_acumulada
    FROM mensal
)
SELECT * FROM acumulado;

-- View global (sem filtro de empreendimento/investidor) para KPIs e grafico geral
DROP VIEW IF EXISTS analytics.v_receita_global CASCADE;

CREATE VIEW analytics.v_receita_global AS
WITH mensal AS (
    SELECT
        EXTRACT(YEAR  FROM data_pagamento)::INT  AS ano,
        EXTRACT(MONTH FROM data_pagamento)::INT  AS mes,
        SUM(COALESCE(realizado, 0))              AS receita_mes,
        SUM(COALESCE(a_realizar, 0))             AS a_realizar_mes
    FROM raw.fluxo_entrada
    WHERE data_pagamento IS NOT NULL
      AND status NOT IN ('DEVOLVIDO C/CORRECAO', 'DEVOLVIDO C/CORREÇÃO')
    GROUP BY 1, 2
)
SELECT
    ano, mes, receita_mes, a_realizar_mes,
    SUM(receita_mes) OVER (
        ORDER BY ano, mes
        ROWS UNBOUNDED PRECEDING
    ) AS receita_acumulada_global
FROM mensal
ORDER BY ano, mes;
"""


def load_fluxo(cur, path):
    print(f"Lendo {path.name}...")
    rows = []
    with open(path, encoding='cp1252', errors='replace') as f:
        reader = csv.DictReader(f, delimiter=';')
        for r in reader:
            data_raw = r.get('Data do Pagamento', '').strip()
            rows.append((
                r.get('Centro de Custos', '').strip() or None,
                r.get('Empreendimento', '').strip() or None,
                r.get('Investidor', '').strip() or None,
                r.get('Título', r.get('T\ufffdtulo', '')).strip() or None,
                r.get('Número do Cliente', r.get('N\ufffdmero do Cliente', '')).strip() or None,
                r.get('Tipo de Investimento', '').strip() or None,
                r.get('Possibilidade de conversão', r.get('Possibilidade de convers\ufffdo', '')).strip() or None,
                r.get('Status', '').strip() or None,
                data_raw or None,
                parse_data(data_raw),
                parse_brl(r.get('Realizado', '')),
                parse_brl(r.get('A realizar', '')),
            ))

    cur.execute("TRUNCATE raw.fluxo_entrada RESTART IDENTITY")
    execute_values(cur, """
        INSERT INTO raw.fluxo_entrada
            (centro_custo, empreendimento, investidor, titulo, numero_cliente,
             tipo_investimento, possibilidade_conversao, status,
             data_pagamento_raw, data_pagamento, realizado, a_realizar)
        VALUES %s
    """, rows)
    print(f"  -> {len(rows)} parcelas carregadas.")


def main():
    conn = psycopg2.connect(DATABASE_URL)
    cur  = conn.cursor()

    print("[1/3] Criando tabela raw.fluxo_entrada...")
    cur.execute(DDL)

    print("[2/3] Carregando FLUXO_ENTRADA.csv...")
    load_fluxo(cur, BASE_DIR / "FLUXO_ENTRADA.csv")

    print("[3/3] Criando views analytics...")
    cur.execute(VIEW_RECEITA)

    conn.commit()
    print("\n[OK] Carga do fluxo concluida!")
    print("Views criadas:")
    print("  - analytics.v_receita_acumulada")
    print("  - analytics.v_receita_global")
    cur.close()
    conn.close()

if __name__ == "__main__":
    main()
