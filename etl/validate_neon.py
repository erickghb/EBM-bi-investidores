import os
import psycopg2
import psycopg2.extras
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(r'C:\Users\erick.aires\Migracao_BI\.env'))
conn = psycopg2.connect(os.getenv('DATABASE_URL'))
cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

print('=== v_controle_investidores (5 primeiros) ===')
cur.execute('SELECT nome_empreendimento, nome_investidor, valor_investido, perc_apl_comprometida FROM analytics.v_controle_investidores LIMIT 5')
for r in cur.fetchall():
    emp = str(r['nome_empreendimento'])[:30]
    inv = str(r['nome_investidor'])[:25]
    val = float(r['valor_investido'] or 0)
    pct = r['perc_apl_comprometida']
    print(f'  {emp} | {inv} | R$ {val:,.2f} | {pct}%')

cur.execute('SELECT COUNT(*) AS total FROM analytics.v_dim_empreendimentos')
print(f'\n=== v_dim_empreendimentos: {cur.fetchone()["total"]} empreendimentos')

cur.execute('SELECT COUNT(*) AS total FROM analytics.v_dim_investidores')
print(f'=== v_dim_investidores: {cur.fetchone()["total"]} investidores')

cur.execute("SELECT COUNT(*) AS total FROM analytics.v_controle_investidores WHERE nome_empreendimento NOT ILIKE 'Obra %'")
print(f'=== Registros com nome real (sem Obra XXX): {cur.fetchone()["total"]}')

cur.execute("SELECT COUNT(*) AS total FROM analytics.v_controle_investidores WHERE nome_empreendimento ILIKE 'Obra %'")
print(f'=== Registros ainda com "Obra XXX": {cur.fetchone()["total"]}')

cur.close()
conn.close()
print('\nValidacao concluida.')
