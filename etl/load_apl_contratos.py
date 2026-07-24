"""
load_apl_contratos.py
---------------------
Carrega APL_VLR_CONTRATO.csv no Neon e cria views para Contratos Assinados.
"""
import csv, os, re, sys
from pathlib import Path
from dotenv import load_dotenv

try:
    import psycopg2
    from psycopg2.extras import execute_values
except ImportError:
    print("ERRO: psycopg2-binary necessario")
    sys.exit(1)

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")
DATABASE_URL = os.getenv("DATABASE_URL")
BASE_DIR = Path(__file__).resolve().parent.parent / "data"

MESES_PT = {
    'janeiro': 1, 'fevereiro': 2, 'março': 3, 'marco': 3, 'abril': 4,
    'maio': 5, 'junho': 6, 'julho': 7, 'agosto': 8, 'setembro': 9,
    'outubro': 10, 'novembro': 11, 'dezembro': 12
}

def parse_data_extenso(s):
    """Converte 'segunda-feira, 25 de novembro de 2024' para '2024-11-25'."""
    s = s.strip()
    if not s: return None
    match = re.search(r'(\d{1,2})\s+de\s+([a-zA-Zç]+)\s+de\s+(20\d\d)', s)
    if match:
        dia = int(match.group(1))
        mes = MESES_PT.get(match.group(2).lower(), 0)
        ano = int(match.group(3))
        if mes > 0:
            return f"{ano:04d}-{mes:02d}-{dia:02d}"
    return None

def parse_brl(s):
    if not s: return None
    s = re.sub(r'[R$\s]', '', s.strip())
    s = s.replace('.', '').replace(',', '.')
    try: return float(s) if s else None
    except: return None

DDL = """
CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS analytics;

DROP TABLE IF EXISTS raw.apl_vlr_contrato CASCADE;
CREATE TABLE raw.apl_vlr_contrato (
    id                      SERIAL PRIMARY KEY,
    centro_custo            TEXT,
    empreendimento          TEXT,
    investidor              TEXT,
    titulo                  TEXT,
    numero_cliente          TEXT,
    tipo_contrato           TEXT,
    possibilidade_conversao TEXT,
    status                  TEXT,
    data_assinatura_raw     TEXT,
    data_assinatura         DATE,
    area                    NUMERIC,
    valor_contrato          NUMERIC,
    carregado_em            TIMESTAMPTZ DEFAULT NOW()
);
"""

def load_data(cur, path):
    print(f"Lendo {path.name}...")
    rows = []
    with open(path, encoding='cp1252', errors='replace') as f:
        reader = csv.DictReader(f, delimiter=';')
        for r in reader:
            data_raw = r.get('Data de Assinatura do Contrato', '').strip()
            rows.append((
                r.get('Centro de Custos', '').strip() or None,
                r.get('Empreedimento', r.get('Empreendimento', '')).strip() or None,
                r.get('Investidor', '').strip() or None,
                r.get('Título', r.get('T\ufffdtulo', '')).strip() or None,
                r.get('Número do Cliente', r.get('N\ufffdmero do Cliente', '')).strip() or None,
                r.get('Tipo de Contrato', '').strip() or None,
                r.get('Possibilidade de conversão para Mútuo', r.get('Possibilidade de convers\ufffdo para M\ufffdtuo', '')).strip() or None,
                r.get('Status', '').strip() or None,
                data_raw or None,
                parse_data_extenso(data_raw),
                parse_brl(r.get('Área', r.get('\ufffdrea', ''))),
                parse_brl(r.get('Valor do Contrato', ''))
            ))

    cur.execute("TRUNCATE raw.apl_vlr_contrato RESTART IDENTITY")
    execute_values(cur, """
        INSERT INTO raw.apl_vlr_contrato
            (centro_custo, empreendimento, investidor, titulo, numero_cliente,
             tipo_contrato, possibilidade_conversao, status,
             data_assinatura_raw, data_assinatura, area, valor_contrato)
        VALUES %s
    """, rows)
    print(f"  -> {len(rows)} contratos carregados em raw.apl_vlr_contrato.")

def main():
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    cur.execute(DDL)
    load_data(cur, BASE_DIR / "APL_VLR_CONTRATO.csv")
    conn.commit()
    print("[OK] Carga de APL_VLR_CONTRATO concluida!")
    cur.close()
    conn.close()

if __name__ == "__main__":
    main()
