import json

path = r"C:\Users\erick.aires\OneDrive - EBM\Documentos\AUTOMATE - BI\gestao_investidores_sp.json"
with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)

items = data.get("items", data) if isinstance(data, dict) else data

for i, item in enumerate(items[:5]):
    print(f"--- Item {i+1} ---")
    print("  ID:", item.get("ID"))
    print("  Title (Investidor):", item.get("Title"))
    print("  CC:", item.get("Centro_x0020_de_x0020_Custo"))
    print("  Valor:", item.get("Valor_x0020_Investido"))
    
    # Check status and tipo_scp values
    st = item.get("Status")
    if isinstance(st, dict): st = st.get("Value")
    print("  Status:", st)
    
    scp = item.get("Tipo_x0020_de_x0020_SCP")
    if isinstance(scp, dict): scp = scp.get("Value")
    print("  Tipo SCP:", scp)
    
    dt = item.get("Data_x0020_assinatura_x0020_do_x")
    print("  Data Assinatura:", dt)
