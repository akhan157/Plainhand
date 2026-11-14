# Modo: oferta -- Avaliação Completa A-F

Quando o candidato cola uma vaga (texto ou URL), entregar SEMPRE os 6 blocos:

## Passo 0 -- Detecção de Arquétipo

Classificar a vaga em um dos arquétipos (primeiro os do candidato em `modes/_profile.md`; se não houver, as famílias de função de `_shared.md`). Se for híbrido, indicar os 2 mais próximos. Isso determina:
- Quais proof points priorizar no bloco B
- Como reescrever o summary no bloco E
- Quais histórias STAR preparar no bloco F

## Bloco A -- Resumo da Vaga

Tabela com:
- Arquétipo detectado
- Domain (setor / especialidade, ex.: saúde, educação, ofícios técnicos, finanças, software)
- Função (executar/atender/coordenar/assessorar/gerir/construir)
- Senioridade
- Remoto (full/híbrido/presencial)
- Tamanho do time (se mencionado)
- TL;DR em 1 frase

## Bloco B -- Match com o Currículo

Ler `cv.md`. Criar tabela com cada requisito do JD mapeado para linhas exatas do currículo.

**Adaptado ao arquétipo:**
- Usar a ênfase que `modes/_profile.md` define para esse arquétipo, quando houver
- Se Hands-on Practitioner → priorizar registros, licenças, certificações e prática direta do trabalho central
- Se People & Service → priorizar as pessoas atendidas, o volume e os resultados para elas
- Se Coordination & Operations → priorizar confiabilidade, escala do que foi coordenado e melhorias de processo
- Se Analysis & Research → priorizar métodos, ferramentas e as decisões que a análise orientou
- Se Creative & Communications → priorizar peças de portfólio, público e alcance mensurável
- Se Technical & Engineering → priorizar o que foi projetado ou construído e como foi validado
- Se Leadership & Management → priorizar tamanho da equipe, orçamento e resultados entregues por meio de outros

Seção de **gaps** com estratégia de mitigação para cada um. Para cada gap:
1. É um hard blocker ou um nice-to-have?
2. O candidato consegue demonstrar experiência adjacente?
3. Existe um projeto do portfolio que cubra esse gap?
4. Plano de mitigação concreto (frase para carta de apresentação, projeto rápido, etc.)

## Bloco C -- Nível e Estratégia

1. **Nível detectado** no JD vs **nível natural do candidato para esse arquétipo**
2. **Plano "vender senior sem mentir"**: frases específicas adaptadas ao arquétipo, conquistas concretas a destacar, como posicionar experiência de founder como vantagem
3. **Plano "se me downlevelearem"**: aceitar se a remuneração for justa, negociar revisão em 6 meses, critérios claros de promoção

## Bloco D -- Remuneração e Demanda

Usar WebSearch para:
- Salários atuais da vaga (Glassdoor, Levels.fyi, Blind, Glassdoor BR)
- Reputação de remuneração da empresa
- Tendência de demanda da vaga

Tabela com dados e fontes citadas. Se não houver dados, dizer isso em vez de inventar.

**Mercado Brasileiro -- Checks obrigatórios:**
- CLT ou PJ? Se CLT: considerar 13º, férias, FGTS, plano de saúde, VR/VA na comparação.
- Se PJ: qual o valor mensal? Calcular equivalente CLT.
- PLR mencionado? Quantos salários extras?
- Stock options / VSOP? Avaliar vesting, cliff e liquidez.
- Vale-refeição / vale-alimentação? Valor mensal?
- Plano de saúde? Coparticipação ou integral?

## Bloco E -- Plano de Personalização

| # | Seção | Estado atual | Mudança proposta | Por que |
|---|-------|-------------|------------------|---------|
| 1 | Summary | ... | ... | ... |
| ... | ... | ... | ... | ... |

Top 5 mudanças no currículo + Top 5 mudanças no LinkedIn para maximizar o match.

## Bloco F -- Plano de Entrevistas

6-10 histórias STAR+R mapeadas para requisitos do JD (STAR + **Reflection**):

| # | Requisito do JD | História STAR+R | S | T | A | R | Reflection |
|---|----------------|-----------------|---|---|---|---|------------|

A coluna **Reflection** captura o que foi aprendido ou o que seria feito diferente. Isso sinaliza senioridade — candidatos juniores descrevem o que aconteceu, candidatos seniores extraem lições.

**Story Bank:** Se `interview-prep/story-bank.md` existir, verificar se alguma dessas histórias já está lá. Se não, adicionar as novas. Com o tempo, isso constrói um banco reutilizável de 5-10 histórias-mestre que podem ser adaptadas para qualquer pergunta de entrevista.

**Selecionadas e enquadradas conforme o arquétipo:**
- Hands-on Practitioner → enfatizar habilidade em condições reais e decisões de julgamento
- People & Service → enfatizar empatia, situações difíceis bem conduzidas e resultados para as pessoas atendidas
- Coordination & Operations → enfatizar acompanhamento até o fim, conciliação de prioridades e um processo quebrado que foi consertado
- Analysis & Research → enfatizar a pergunta, o método e o que mudou por causa disso
- Creative & Communications → enfatizar o público, a ideia e a resposta que ela recebeu
- Technical & Engineering → enfatizar o problema, os trade-offs e como foi testado
- Leadership & Management → enfatizar desenvolvimento de pessoas, decisões difíceis e resultados da equipe

Incluir também:
- 1 case study recomendado (qual projeto apresentar e como)
- Perguntas red-flag e como respondê-las (ex: "Por que você vendeu sua empresa?", "Você tinha reports diretos?")

---

## Pós-avaliação

**SEMPRE** após gerar os blocos A-F:

### 1. Salvar report .md

Salvar avaliação completa em `reports/{###}-{company-slug}-{YYYY-MM-DD}.md`.

- `{###}` = próximo número sequencial (3 dígitos, zero-padded)
- `{company-slug}` = nome da empresa em lowercase, sem espaços (usar hifens)
- `{YYYY-MM-DD}` = data atual

**Formato do report:**

```markdown
# Avaliação: {Empresa} -- {Vaga}

**Data:** {YYYY-MM-DD}
**Arquétipo:** {detectado}
**Score:** {X/5}
**URL:** {URL da vaga}
**PDF:** {caminho ou pendente}

---

## A) Resumo da Vaga
(conteúdo completo do bloco A)

## B) Match com o Currículo
(conteúdo completo do bloco B)

## C) Nível e Estratégia
(conteúdo completo do bloco C)

## D) Remuneração e Demanda
(conteúdo completo do bloco D)

## E) Plano de Personalização
(conteúdo completo do bloco E)

## F) Plano de Entrevistas
(conteúdo completo do bloco F)

## G) Rascunhos de Respostas para Candidatura
(apenas se score >= 4.5 -- rascunhos de respostas para o formulário de candidatura)

---

## Keywords extraídas
(lista de 15-20 keywords do JD para otimização ATS)
```

### 2. Registrar no tracker

**SEMPRE** registrar em `data/applications.md`:
- Próximo número sequencial
- Data atual
- Empresa
- Vaga
- Score: média do match (1-5)
- Status: `Evaluated`
- PDF: ❌ (ou ✅ se a auto-pipeline gerou PDF)
- Report: link relativo ao report .md (ex: `[001](reports/001-company-2026-01-01.md)`)

**Formato do tracker:**

```markdown
| # | Data | Empresa | Vaga | Score | Status | PDF | Report |
```
