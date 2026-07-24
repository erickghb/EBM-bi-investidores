import csv, re

def parse_brl(s):
    if not s: return 0.0
    s = re.sub(r'[R$\s]', '', s.strip())
    s = s.replace('.', '').replace(',', '.')
    try: return float(s) if s else 0.0
    except: return 0.0

with open(r'C:\Users\erick.aires\Migracao_BI\data\APL_VLR_CONTRATO.csv', encoding='cp1252', errors='replace') as f:
    reader = list(csv.DictReader(f, delimiter=';'))

print("=== TODOS OS REGISTROS EM APL_VLR_CONTRATO ===")
for r in reader:
    status = r.get('Status', '').strip()
    data = r.get('Data de Assinatura do Contrato', '').strip()
    match = re.search(r'20\d\d', data)
    ano = match.group(0) if match else 'Sem Ano'
    val = parse_brl(r.get('Valor do Contrato', ''))
    print(f"Status: {status:25} | Ano: {ano} | Data: {data:40} | Valor: R$ {val:12,.2f} | Investidor: {r.get('Investidor', '')[:25]}")
