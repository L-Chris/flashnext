# 词表与词典导入规范草案

本轮为只读评估，未修改生产词条、卡片、标签或学习记录。

## 来源分工

1. 词表来源只决定收词范围、词表内顺序、分级及章节。同一词可属于多个词表。
2. 本地 Kaikki 原始快照提供词性、词源组、义项、音标、词形、例句、中文译词及用法标签；来源缺失必须保留缺失状态。
3. 词表章节和词典义项通过显式映射关联。章节名称不能自动确定唯一词义。
4. 人工校订是有来源的覆盖层，不修改原始快照，不能被下次自动导入冲掉。

## 分类标准

- COCA：词频排名及项目自定义频段。保留真实来源的 rank、词形/lemma/词性统计单位；不要先去重再把数组下标当原始排名。L4 不等于雅思等级，L5 不等于学术领域或 GRE 等级。未证实的文本覆盖百分比不作为标准。
- CET：优先教育考试院公开大纲附表，明确版本；分别定义 CET-4、CET-6 是完整集合还是六级增量，不根据名称猜测是否包含四级。
- IELTS：教材/词表归属，如《雅思词汇真经》某版本及章节；不要将“雅思核心 level=1”解释成 IELTS 分数等级。热门转录记录为 community，不能标成 publisher/official。
- CEFR：可单独增加牛津官方词表的 A1–C1 分级，保留词性或来源提供的义项范围；不从 COCA 排名推算 CEFR。

来源清单至少包含：source_id、title、publisher/maintainer、authority_type、edition、URL、revision、retrieved_at、SHA-256、许可信息、统计单位、累计/增量规则。未选定新来源并逐词对照前，不预测新各级人数。

## 词条与义项标准

- Word.id 作为现有词条锚点保留。Kaikki 同拼写多行可能属于不同词性/词源，必须读取全部记录，不能 first match wins。
- 保留 Unicode 重音、专名大小写和短语空格。别名匹配通过 alt_of/form_of 与人工映射确认；不可统一去重音、小写或去连字符后强行合并。
- 义项保留源 sense id（若存在）、词性、词源编号、全部 glosses 层级、标签、领域、例句与中文译词。数组序号只用于展示顺序，不作为稳定身份。
- 普通视图默认降低 archaic/obsolete/rare 等义项的优先级，不从原始存储抹去；不能默认前三义就是高频义。
- 例句优先明确的 type=example，引用 type=quotation 分开保存并保留出处；过滤关系标记、抽取噪声。无例句的义项仍应入库。
- 音标保留英美/地区标签、关联词性/词源与 IPA 原文，显示层处理 /.../，不能混成一个无地区标记的字符串。
- sense.translations 是已消歧译词；entry.translations 是未消歧译词。顶层译词必须保留 sense 提示作为候选映射，不能复制到每个义项。
- 中文译词不等于完整中文释义，更不等于例句译文。没有中文时保留英文释义，或使用明确标为 legacy 的现有中文；不能伪称来自 Kaikki。机翻若以后引入须标来源并审核，本轮不引入。

## 迁移及验收

先生成 staging 数据及差异报告，再执行可回滚导入。比较词条增减、标签变化、义项数、释义/音标/例句变化、缺失项、歧义映射与受影响卡片。

更新词典内容只关联已有 Word.id，保留 Card.id、ReviewLog、FSRS、PersonalKnowledgeState；不因词表移除就删除用户词条或卡片，不因新增词表自动批量建卡。

现有 Word.translation/phonetic/pos、KnowledgeEntity.summary 与 Card.back 是兼容/显示投影，需要同一版本统一生成。只改词典表会造成列表、复习背面和搜索显示不一致。保留显式人工覆盖。

新义项不会继承“已掌握”结论：目前调度按卡片/单词工作。如果未来改成按义项独立复习，应另做迁移设计，不能复制原词的熟练度给所有义项。

已恢复的 86 条 IELTS 章节用法作为来源映射层保留。可映射到 Kaikki 义项，但未经核实不能删除现有章节释义。

验收必须包括：重跑不增加记录、引用关系无悬空、迁移前后学习数据不变、缺失数据不覆盖现有有效内容、别名循环/多候选进入审核队列、不同词性/同形异义不误并、源数据更新可追溯。

## 参考

- [CET 官方大纲](https://cet.neea.edu.cn/xhtml1/folder/16113/1588-1.htm)
- [Oxford 3000/5000](https://www.oxfordlearnersdictionaries.com/about/wordlists/oxford3000-5000)
- [COCA 数据单位](https://www.english-corpora.org/coca/help/download.asp)
- [Wiktextract 结构说明](https://github.com/tatuylonen/wiktextract)
- [当前 IELTS 转录快照](https://github.com/RealKai42/qwerty-learner/blob/1182426f2bd0a28c95302c33f9e19136b1262a70/public/dicts/IELTSVocabularyBible.json)
