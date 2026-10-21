# 最近学习及全部未学英语词的音标核对

本次只处理音标，不生成音频。范围按 2026-10-21 的数据库快照冻结：从北京时间 2026-09-21 04:00 起首次学习的 827 张英语词卡，以及全部 1,137 张尚未学习的英语词卡，合并为 1,964 个词。首次学习取该卡所有 `state=0` 日志中的最早时间；最近复习过的旧词不会因此进入范围。未学卡条件为 `state=0 AND reps=0`，没有七天或数量上限。

## 结果与来源

1,959 个词已有可采用的英音记录。原有 1,034 个 legacy 词中，1,029 个完成规范化，5 个保留原状待补充证据。共更新 1,427 个词的音标或规范状态，其中 1,338 个显示值变化，89 个显示值不变、只更新规范状态；其余 532 个词的显示值和规范状态保持不变。同步 1,338 张系统卡背及 2 条可唯一对应的 IELTS 用法音标。

核对以牛津学习词典明确标注的 BrE 整词音标为主要依据，使用本地 Kaikki 补充词性、词形及明确 UK/RP 候选；特殊词再核对剑桥或柯林斯的英音记录。不是把 legacy 全部判为错误，也不把美音通过字符替换变成英音。

牛津解析只读对应词条的英音，区分表头、词形表、拼写变体和同形词编号；动词变形不能混入原形音标。跨词性使用读音时，要求本地对应词性的完整音标与已核对英音一致，或记录单独的词条核验依据。部分历史词性字段与来源不一致，本轮保留原字段，发音子记录使用已核对的词性。

例如 `converse` 区分“相反事物”和“交谈”，`upsurge` 区分动词和名词重音，`numerate` 保留动词与形容词差异；`fungi` 关联 fungus 的复数，`primate` 分开记录动物和主教的读法。原始音标及来源记录保留，显示层不增加“待核验”提示。

逐条依据及默认读音优先级保存于 [发音校订资源](../../server/scripts/resources/study-pronunciation-overrides-20261021.json)。全部差异见 [production-migration.json](production-migration.json)，字段保护结果见 [production-verification.json](production-verification.json)。

## 尚未填入的五个词

- `photodissociation`：当前取得的整词音标明确标为美音，未从其推算英音。
- `patriarchic`：找到相关词和派生词说明，尚无足够可靠的完整英音记录。
- `synchronizer`：已有候选不一致，未把 synchronize 的读音直接当作该词音标。
- `imagist`：未把 imagism 的读音移用到该词；搜索缓存中的书籍摘录尚不能完整复核。
- `short-day`：词典英音栏目没有整词音标，未直接删改美音中的 r 来补缺。

这五个词原音标为空；保持词条、卡片和学习数据，后续音频生成须先处理其读音依据。详情见 [pending.json](pending.json)。

## 导入保护与复现

导入器只接受冻结清单中的英语词，核对词条身份、当前词性、释义及原音标后，在事务中写入。旧候选保留，仅将被替代的展示记录转为 review。只同步精确匹配系统模板的卡背，自定义正文不覆盖。SQL authorizer 禁止写入学习字段及其他表。正式应用前暂停服务写入并创建独立 SQLite 备份。

审计、生成计划和导入脚本在宿主机运行，需要 Python 3、Beautiful Soup 4 和 lxml；全量既有发音准备脚本仍只使用标准库。原始词典、查询缓存和冻结清单位于被 Git 忽略的 `server/scripts/data/study-pronunciations-2026-10-21/`，不含 API 密钥，不调用付费模型。

```sh
python3 server/scripts/audit-study-pronunciations.py \
  --db /path/to/copy.db --since-ms 1789934400000 \
  --output /path/to/new-audit --fetch

python3 server/scripts/plan-study-pronunciations.py \
  --batch /path/to/audit --kaikki /path/to/kaikki-subset.json \
  --manual /path/to/reviewed-exceptions.json

# 默认只预览；应用需 --apply 和独立 --backup。
python3 server/scripts/import-study-pronunciations.py \
  --db /path/to/copy.db --input /path/to/audit/plan.json \
  --report /path/to/diff.json

python3 server/scripts/tests/pronunciations.py
python3 server/scripts/tests/study-pronunciations.py
```

副本验证包括所有表的保护字段、范围外词条不变、外键与完整性检查、重复导入零变更。现有全量 `prepare-pronunciations.py` 已接入校订资源，实测后续全量导入预览中词、卡背及 IELTS 用法变更均为零。当前后端和 Web 已支持这些字段，无需修改接口或重新构建页面。

正式备份：`server/data-backup/flashnext-pre-study-phonetics-20261021.db`。恢复学习后如需回退，应依据逐词差异做字段级撤回，不应覆盖整库而丢失后续复习记录。

## 多读音说明的展示优化

后续 Web 展示调整让多读音默认显示各自已有的词性、词义或时态说明，覆盖复习背面和牌组列表的读音列。例如 primate 显示“灵长目动物”及“首席主教、大主教”，read 显示原形／现在时及过去式／过去分词。词性和完整用法说明相同的读音合并，用“或”连接；相同音标的记录去重，保持各用法与音标的对应。通用的“名词读法”等说明只保留词性缩写。单读音保持简洁，复习背面默认显示全部分组；列表超过两组时提供展开按钮，点击不会触发整张卡片展开。

这是展示层调整，不增改数据库、学习记录或音频。已有卡片中 829 个词有多条已采用的音标，其中 695 个词可以合并至少一组备选读音，167 个词仍保留多组不同说明（两个计数有交集）。逐词只读渲染核查未发现音标或已有用法说明丢失，见 [display-verification.json](display-verification.json)。这一检查验证展示完整性，不等同于重新核验所有词典义项；原记录只有词性时，界面不会自动编造义项或中文翻译。

Web 构建及 9 项浏览器测试通过，覆盖桌面／手机、同词性不同义、时态区别、同音标多词性、变体去重、默认读音排序、候选过滤、列表展开、口音隔离、单读音及自定义卡背。这一展示更新需要重新构建 Web：

```sh
cd web
npm run build
FLASHNEXT_TEST_BASE_URL=http://127.0.0.1:19006 npx playwright test tests/pronunciations.spec.ts
```

浏览器测试使用完整 API 拦截和模拟队列，不读写实际学习数据。

部署后，使用真实 primate、read、permit、bow、fungi、converse、tear、desert 卡片，在 1200px 和 390px 视口完成 16 次只读浏览器检查，均无横向溢出。复习队列由浏览器拦截替换，接口仅允许 GET，不提交评分或学习记录；详情见 [display-browser-verification.json](display-browser-verification.json)。Docker 服务健康检查正常。

### 重复释义去重

复习背面的多读音说明若已覆盖全部中文释义，就不再重复显示下方系统释义。例如 primate 只在两个音标下显示相应词义，隐藏重复的“n. 大主教, 灵长目动物”。匹配要求每一行释义的词性及按逗号、顿号、分号分隔的全部义项均能与已采用音标的中文说明明确对应，不进行同义词推断；有补充内容、词性不符、只有词性说明或单读音时，保留原释义。自定义卡背及日语显示不参与此项去重。

对现有卡片做只读检查，本次只有 primate 满足完整覆盖条件。Web 构建及更新后的 12 项浏览器测试通过，包含桌面／手机隐藏重复释义和保留补充释义的检查。此项只修改 Web 展示，不改数据库内容。

部署后再用真实 primate 和 permit 完成桌面／手机共 4 次检查：前者隐藏重复释义，后者保留补充释义，均无横向溢出。结果见 [duplicate-meaning-verification.json](duplicate-meaning-verification.json)。
