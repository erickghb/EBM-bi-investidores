$gitPath = "C:\Users\erick.aires\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe"
& $gitPath add -A
& $gitPath commit -m "Chore: Limpeza de arquivos obsoletos e organizacao arquitetural do projeto"
& $gitPath push origin main
