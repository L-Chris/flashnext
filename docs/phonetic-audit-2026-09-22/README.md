# 音标规范调研、实测与修正方案

日期：2026-09-22。本轮只读访问生产数据库，新增审计和预览文件，未修改单词、卡片或学习记录。商业 API 未进行带密钥调用；剑桥使用官方公开词条核对，牛津使用官方文档验证能力，不冒称 API 覆盖率实测。

## 结论与目标规范

建议采用「学习词典风格的宽式 IPA，默认英音，另列美音」，以剑桥 UK / 牛津学习词典的符号说明作为可查验参考。这里是拟定的项目规范，不宣称中国所有教材采用一套逐字符相同的标准；本轮没有取得用户指定教材版本的音标表。标音体系和口音是两个维度，统一 IPA 不等于必须放弃美音。

建议显示：`/deɪ/`、`/ɡəʊ/`、`/bed/`、`/bɜːd/`、`/ˈhæpi/`；长音用 ː，重音用 ˈ / ˌ；保留弱元音 i/u，不全局改成 ɪ/ʊ 或补长音。宽式转写使用 /…/；不要把窄式 […] 去掉括号冒充宽式。单音节重音通常不显示，需确认单音节而不是简单数元音字符。连接 r 可以结构化保存，在展示时标为 (r)。

牛津学习词典官方说明明确：不同出版社乃至同出版社不同书的符号选择可能不同；bed 的 e 与 ɛ 可以属于不同转写约定，不能把 ɛ 本身判为发音错误。Oxford Dictionaries API 和 Oxford Advanced Learner’s Dictionary 是不同产品，不能假设前者原样返回教材风格。

参考：
- https://www.oxfordlearnersdictionaries.com/about/english/pronunciation_english
- https://www.oxfordlearnersdictionaries.com/external/pdf/english/OALD10_phons_GL.pdf
- https://dictionary.cambridge.org/help/phonetics.html

## 导入根因及复现

`server/scripts/import-words.js` 明确优先 CMU ARPAbet → KK 风格转换，回退 ECDICT。映射包括 EY→e、OW→o、EH→ɛ、ER→ɝ/ɚ、IY→i、UW→u。它按遇到元音就结束一段的方式放置重音，不能可靠推断音节边界；只取 CMU 的第一个读音，丢掉词形/词性对应的多读音。IELTS 导入从 ECDICT 读音标，现有词共享同一个 Word，因此 IELTS 标签不保证读音来自该次导入。

复现实测另发现：当前 CMU 文件用单空格分隔，现有 `collectCmudict` 查找两个连续空格，原函数对当前文件匹配数为 0。仅在审计中改用通用空白解析后，17,538 个现有词可在 CMU 匹配，其中 **16,672 个词的当前音标与现有转换函数输出完全一致**。这强烈支持当前数据主要来自该转换逻辑，但不是对历史每次导入的来源证明。现有脚本直接重跑还可能全量回退 ECDICT，不能将重跑当作修复。

复现脚本 `reproduce-cmu.cjs` 只抽取原文件中的纯转换与读取函数，不运行导入入口；输出见 `cmu-reproduction.json`。

当前已关联卡片 8,648 张，位于“英语单词”卡组。其中对应 Word 音标为空 22 个；含 ɛ 1,549 个、ɚ 1,130 个、ASCII 冒号 138 个、ASCII 单引号 529 个。全库音标字段有 3 个包含斜线，现有显示层又包裹斜线，需检查重复定界符。这些是风格特征计数，不是相互排斥的错误分类或错误总量。

## 本地 Kaikki 全量实测

按当前数据库 headword 精确匹配，扫描本地全部英文条目及 sounds。以下均按词去重，任意一条符合即计数，不表示该词所有词性/义项发音已覆盖。

| 范围 | 词数 | 任意 IPA | 明确 UK / Received-Pronunciation 等标签 | 上述标签且 /…/ 包裹 |
|---|---:|---:|---:|---:|
| 全库 | 18,451 | 16,189（87.7%） | 9,462（51.3%） | 9,363（50.7%） |
| 已有卡片对应词 | 8,648 | 8,310（96.1%） | 5,271（61.0%） | 5,199（60.1%） |
| IELTS 标签词 | 3,628 | 3,571（98.4%） | 2,323（64.0%） | 2,290（63.1%） |

标签规则仅检查 UK、Received-Pronunciation、Standard-Southern-British。原数据还有拆开的 British + Southern + Standard 标签，以及 note 文本、共享/无标签读音；此次没有将其自动并入。无标签不等于所有口音通用，UK 标签也不能保证没有更窄地区或历史限定。这是保守检索覆盖，不是自动修复通过率；/…/ 也可能含缩略、弱读和非常规转写。

原始计数和 24 个针对性样词见 `results.json`；复现 `python3 docs/phonetic-audit-2026-09-22/audit.py`。

## 同词核对及转换预览

| 词 | 数据库当前音标 | 本地原始候选/外部核对 | 建议处理 |
|---|---|---|---|
| go | ˈɡo | Kaikki RP /ɡəʊ/；牛津学习词典音标表一致 | 英音显示 /ɡəʊ/，不是单纯补格式 |
| day | ˈde | Kaikki RP/GA /deɪ̯/ | 在目标宽式规范下显示 /deɪ/ |
| bed | ˈbɛd | Kaikki RP/GA /bɛd/；牛津学习表 /bed/ | 已确认该词转写对应后用 /bed/；不是认定源 ɛ 错误 |
| bird | ˈbɝd | 剑桥 UK /bɜːd/；Kaikki 原始候选很多且标签复杂 | 按口音取值，不把 ɝ 全局替成 ɜː |
| teacher | ˈtitʃɚ | Kaikki RP /ˈtiː.t͡ʃəː/；剑桥 UK 末尾为 ə 和连接 r 提示 | 末尾 əː 与学习词典不一致，进入人工核验，不静默接受 RP 标签 |
| environment | ɪˈnvaɪrənmənt | Kaikki RP /ɪnˈvaɪ.ɹən.mənt/，另有省略 n 的变体 | 候选 /ɪnˈvaɪrənmənt/，修正重音位置；保留变体信息 |
| record | rəˈkɔrd | Kaikki 名词 /ˈɹɛk.ɔːd/、动词 /ɹɪˈkɔːd/；剑桥公开词条对应 | 分词性显示 /ˈrekɔːd/ 和 /rɪˈkɔːd/，不能只存一个 |
| read | ˈrɛd | Kaikki /ɹiːd/ 和另一词源组 /ɹɛd/ | 原形 /riːd/，过去式/分词 /red/，必须按形态关系区分 |
| bow | ˈbaʊ | Kaikki 弓等用法 /ˈbəʊ̯/，鞠躬等 /baʊ/ | 对应义项展示 /bəʊ/ 与 /baʊ/；保护现有 IELTS 用法映射 |
| happy | ˈhæpi | Kaikki RP /ˈhæpi/，牛津表一致 | 保留，不能因为末尾 i 没有长音就“修正” |

`preview.py` 对已选定的宽式 RP/UK 样本做小范围显示实验，生成 22 条预览并通过 4 个针对性断言。仅在这些已限定来源的样本中使用 ɹ→r、ɛ→e、去音节点/连音线/非音节符等规则；不是可以对全库执行的通用 IPA 转换器。teacher、read 和缩略发音明确标为待核验。

公开交叉核对：
- https://dictionary.cambridge.org/us/pronunciation/english/record
- https://dictionary.cambridge.org/us/dictionary/english/bird
- https://dictionary.cambridge.org/pronunciation/english/teacher
- https://www.oxfordlearnersdictionaries.com/about/english/pronunciation_english

## 三种数据源的实际作用

**Kaikki：本地批量候选主来源。** 保留 sounds 原文、tags、note、词性、词源、forms/sense 关联。能够显著减少从旧 KK 猜发音的工作；但单凭有 IPA 或 RP 标签仍不能自动上线。缩略读音如 record 的 /ɹə-/ 不能独立显示成整词音标；无标签也可能在 note 中指定澳大利亚等口音。

**剑桥：学习风格的校验参照或经授权补缺来源。** 官方公开样例可核验英美、词性、多读音及连接 r。API 外层 JSON 中 entryContent 可能为 XML/HTML，连接 r 的上标不能当普通字符盲目拼接。标准 API 条款限制缓存、预取和独立存储，批量永久导入需取得相应授权。本轮没有密钥，未验证实际 API 返回或全词库覆盖。

**牛津 Dictionaries API：有地区标记的结构化 IPA 候选。** 官方确认 en-gb/en-us、pronunciations 中 IPA 和音频；但不是牛津高阶学习词典接口，仍需核验具体符号约定。免费 sandbox 限 500 次且只允许首字母，无法直接拿本轮所有样词测试；离线保存需 Enterprise。不能为统一音标风格就默认全量购买或迁入。

官方依据：
- https://dictionary-api.cambridge.org/api/specification
- https://dictionary-api.cambridge.org/api/terms-and-conditions
- https://developer.oxforddictionaries.com/faq

## 修正设计

### 数据与显示契约

新增 WordPronunciation 或等价子表，不让 Word.phonetic 继续承担多口音、多词性、多词形身份。至少保存：wordId、lexeme/词源键、pos、form/usage 关联、accent、source、sourceRevision、sourceRecordKey、rawIPA、displayIPA、notationProfile、tags/note、audio、reviewStatus、normalizerVersion。

独立保留原始 IPA 和显示 IPA。同一来源多读音全部保留；审定默认项与替代项分开。来源缺失时不要给旧值猜 UK 标签，旧值明确标记 legacy-unverified。

默认英音为本方案的产品建议，美音可切换/并列；若只希望统一符号而保留当前美音，则改变默认口音，不必换数据模型。音频以后也须匹配所显示的口音和用法。

### 导入与审核流程

1. 停止旧 CMU→KK 路径覆盖主展示字段，统一所有来源经过同一个发音导入适配层；先修复 CMU 文件分隔格式并保留为美音参考，不从 CMU 猜英音。
2. 全量抽取候选，明确区分宽式、窄式、弱读、历史/方言、词形和缩略读音。处理 tags 与 note 双通道及显式变体关系；不能拿第一条声音作为默认。
3. 仅对已知来源、已知转写规范执行显示转换。安全格式处理包括 Unicode NFC、首尾空白、按源规则统一长音/重音、只包一层斜线。ɛ→e、ɹ→r、去附加符号等属于有前提的转写规则。不得全局 i→iː、o→əʊ、ɚ→ə、删 r 或重排重音。
4. 输出候选差异 CSV/JSON：词、旧值、原始候选、目标展示、口音/词性、依据、状态。分类为已核验可迁移、多个候选待选择、源缺失保留旧值、源冲突待审核。不要把候选覆盖数当修复数。
5. 第一批处理 go/day/bed、单音节标记和明确多读音问题；teacher 等异常必须审核；再扩展到全部已建卡词及 IELTS 词。

### 迁移与验收

先在数据库副本迁移并备份映射；保持 Word.id、Card.id、复习记录和调度状态不变。统一更新 Word.phonetic 兼容字段、系统生成 Card.back、词表展示及 IELTS 用法音标的显示逻辑；检测人工修改过的卡背，不能覆盖其笔记。`CardTable`、`ReviewView`、`IeltsUsages` 应共用格式化组件，不能分别拼字符串。

验收包括：输入重复执行结果不变；源音标可追溯；同形异音不合并；read 时态与 record 词性正确；happy 弱元音不被错误补长；teacher 异常被拦截；旧脚本不能重新污染；卡片/复习数据不增删；定界符不重复；缺源不清空。完成差异审查后才迁移生产。
