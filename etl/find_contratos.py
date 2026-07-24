import csv, re

def read_csv(path):
    with open(path, encoding='cp1252', errors='replace') as f:
        return list(csv.DictReader(f, delimiter=';'))

apl = read_csv(r'C:\Users\erick.aires\Migracao_BI\data\APL_VLR_CONTRATO.csv')
print("=== APL_VLR_CONTRATO.csv ===")
print("Colunas:", apl[0].keys() if apl else "vazio")
for r in apl[:5]:
    print(r)

fluxo = read_csv(r'C:\Users\erick.aires\Migracao_BI\data\FLUXO_ENTRADA.csv')
print("\n=== FLUXO DE ENTRADA ===")
print("Colunas:", fluxo[0].keys() if fluxo else "vazio")

gestao = read_csv(r'C:\Users\erick.aires\Migracao_BI\data\GESTAO_DE_INVESTIDORES.csv')
print("\n=== GESTAO DE INVESTIDORES ===")
print("Colunas:", gestao[0].keys() if gestao else "vazio")
