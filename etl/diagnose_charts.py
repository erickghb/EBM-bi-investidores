import os, psycopg2, psycopg2.extras
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(r'C:\Users\erick.aires\Migracao_BI\.env'))
conn = psycopg2.connect(os.getenv('DATABASE_URL'))
cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

# 1. Amostras de data_assinatura para entender o formato
print("=== data_assinatura (10 amostras) ===")
cur.execute("SELECT DISTINCT data_assinatura FROM raw.gestao_investidores WHERE data_assinatura IS NOT NULL LIMIT 10")
for r in cur.fetchall():
    print(f"  '{r['data_assinatura']}'")

# 2. Amostras de data_lancamento do landbank
print("\n=== data_lancamento LANDBANK (10 amostras) ===")
cur.execute("SELECT DISTINCT data_lancamento FROM raw.landbank WHERE data_lancamento IS NOT NULL AND data_lancamento <> '' LIMIT 10")
for r in cur.fetchall():
    print(f"  '{r['data_lancamento']}'")

# 3. Verificar campos de tolerância e penalidade na gestao
print("\n=== Campos de acompanhamento (gestao_investidores) ===")
cur.execute("""
SELECT data_lancamento_tolerancia, data_conclusao_tolerancia,
       penalidade_lancamento, penalidade_conclusao, plano_de_acao, nome_intermediador
FROM raw.gestao_investidores
WHERE data_lancamento_tolerancia IS NOT NULL
LIMIT 5
""")
for r in cur.fetchall():
    print(dict(r))

cur.close()
conn.close()
