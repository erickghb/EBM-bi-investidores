import os, psycopg2, psycopg2.extras
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path('C:/Users/erick.aires/Migracao_BI/.env'))
conn = psycopg2.connect(os.getenv('DATABASE_URL'))
cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

cur.execute("""
    SELECT
        SUBSTRING(data_assinatura FROM '[0-9]{4}')::INT AS ano,
        SUM(COALESCE(valor_investido, 0)) AS valor
    FROM raw.gestao_investidores
    WHERE data_assinatura IS NOT NULL
      AND data_assinatura ~ '[0-9]{4}'
      AND COALESCE(ativo_inativo, '') <> 'Inativo'
    GROUP BY ano
    ORDER BY ano
""")
rows = cur.fetchall()
acum = 0
print("=== CONTRATOS ASSINADOS POR ANO ===")
for r in rows:
    val = float(r['valor'])
    acum += val
    print(f"Ano: {r['ano']} | Contratos: R$ {val:15,.2f} | Acumulado: R$ {acum:15,.2f}")
