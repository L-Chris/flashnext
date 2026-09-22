# 雅思词汇真经词表核对（2026-09-18）

本轮只核对核心词表的来源、词形、顺序、重复与完整性；未改动原始 ielts.txt、生产数据库或卡片。没有使用 Kaikki 判定一个词是否属于本书，也没有重新下载 Kaikki。

## 结论及证据边界

- 本地 3,630 行无重复，与 Qwerty Learner 的 `IELTSVocabularyBible.json` 3,673 条记录提取 name、保持首次出现顺序去重后的结果逐行完全相同（包含大小写和重音字符）。这足以确定数据同源关系，但没有下载日志，不能证明上一位 agent 直接从该 URL 下载。
- Qwerty 数据包含 43 个各出现两次的词形，因此 3,673 − 43 = 3,630。不能把这 43 条全部称为漏词；去重丢失的是章节出现位置及潜在的不同义项。
- 与两个其他完整网络转录逐条比对，均发现本地缺少 `surprising`。两者都为 3,674 条，但未证明彼此独立，不能当成两份独立原书证据。将此列为“高可信漏词候选”，仍保留原书核验状态。
- 22 个章节都能完整对齐，没有发现整章遗漏。参考转录第 21 章为 417 条，Qwerty 对齐后为 416 条，其余各章条数一致。章节映射来自网络转录，不是原书页码。
- 未发现相对 Qwerty 的额外混入词或新增抄录错误。相对整本原书的零混入、零错字不能在没有原书全文时保证。

## 版本定位

最吻合的书目候选：刘洪波《雅思词汇真经 / Vocabulary for IELTS》，外语教学与研究出版社，2018 年，ISBN **9787521304558**，324 页，22 章、3,600 多核心词。

[湖南大学馆藏书目及 MARC](https://opac.hnu.edu.cn/opac/book/2000366392)确认上述信息；[学为贵配套音频页](https://www.guixue.com/words/primary_list.shtml)的 22 章名称和顺序与网络词表一致。

这属于“书目体系高度吻合”，不是“具体印次已验证”。Qwerty 数据及其元数据没有提供 ISBN、版权页或印次。图书馆页面的“中图分类号 H313 版次 5”是分类法版本（MARC 690$v5），不能误读为本书第 5 版。同名书还有其他出版版本，不能仅凭书名混用。

## 逐项发现

| 项目 | 本地位置 | 证据与判断 |
|---|---|---|
| surprising | 应位于第 3406 行 favour 与第 3407 行 startle 之间 | my-ielts 手工录入版与 fan4love 全表均包含，Qwerty 与本地均缺。高可信漏词候选；待原书最终确认。 |
| résumé / resume | 第 2432 行 resume；Qwerty 第 2458、3409 条 | 手工版分别标为简历名词与恢复动词；本地仅保留一个 resume。resume 也可作无重音的简历拼写，不能简单判成拼写错误，但章节/词性/读音不应合并丢失。 |
| El Niño | 第 22 行 | 原文件及 Qwerty 都有，其他转录为 El Nino；不是词表漏词。前轮只读数据库核对已确认导入正则排除了它。 |
| shade-tolerant | 第 282 行 | 多个参考都存在，本地文件也存在；前轮数据库中未收录，属于导入遗漏，不是词表来源遗漏。 |
| merger / merge | 第 792 行 merger | 博客转录为 merge；手工版支持本地 merger，名词合并。保留本地，待原书核对。 |
| jury / fury | 第 2517 行 jury | 博客为 fury，手工版为 jury 且释义陪审团。高度疑似博客抄错，不能照博客替换。 |
| teenager / teenage | 第 2814 行 teenager | 博客为 teenage，手工版支持 teenager。保留本地，待原书核对。 |
| whistle / whistler | 第 2932 行 whistle | 博客为 whistler，手工版支持 whistle，释义口哨/吹口哨。保留本地，待原书核对。 |

博客还存在 percent/per cent、recognise/recognize、instalment/installment、mesmerise/mesmerize 差异，归为词形/地区拼写差异，不据此判错。

手工版与本地的其他主要差异也为地区拼写：hybridise/hybridize、artefact/artifact、fibre/fiber、jewellery/jewelry、flavour/flavor、organisation/organization、manoeuvre/maneuver、honour/honor、neighbourhood/neighborhood、baptise/baptize、favour/favor、apologise/apologize、sceptical/skeptical 等。手工版用 tire 表示轮胎，而本地同时保留 tyre（轮胎）和 tire（疲倦）；不能全局归一化后把两个学习义项合并。

## 来源固定与复现

1. [Qwerty 数据固定版本](https://github.com/RealKai42/qwerty-learner/blob/1182426f2bd0a28c95302c33f9e19136b1262a70/public/dicts/IELTSVocabularyBible.json)，仓库快照 `1182426f2bd0a28c95302c33f9e19136b1262a70`。同快照 `src/resources/dictionary.ts` 明确命名“雅思词汇真经”，长度 3673。该文件最近修改提交为 `c2e2cdf10c68433ebcdeb96739413818ffc1db33`；最初上传提交 `d7d5eabc6c6c2fc2c9d50ac1293881a057fa9679`。第三方整理，不是出版社数据。
2. [my-ielts 手工录入固定版本](https://github.com/hefengxian/my-ielts/blob/5cef573933663c4673c6e0093f1df04e68018b1a/src/pages/vocabulary/vocabulary.txt)，快照 `5cef573933663c4673c6e0093f1df04e68018b1a`。仓库主 README 称来自刘洪波橙色那本；词汇目录 README 明确说明主要为手打。例句有后续增补，不能把所有内容当成原书逐字转录。
3. [fan4love 全表](https://fan4love.wordpress.com/ielts-vocabulary/)，2026-09-18 获取，HTML 表格解析为 3674 条。第三方网络转录，有明显疑点，不作为单一真值。
4. 学为贵官方配套页只提供章节及音频，不能用章节一致证明逐词一致。

本地参考快照存于 `server/scripts/data/ielts-audit-2026-09-18/`（由现有 Git 忽略规则排除）；完整文件散列见 summary.json。没有把第三方全量内容加入版本控制。

执行：`python3 docs/ielts-audit-2026-09-18/compare.py`

- `summary.json`：数量、精确相等判断、手工版原始差集、SHA-256。
- `reference-differences.csv`：Qwerty 与博客转录的全部序列差异。
- `duplicate-occurrences.csv`：43 个重复词及原始位置、对应章节。
- `chapter-counts.csv`：22 章条目对照。

## 建议的下一步

保留现有词表作为“Qwerty Learner 转录的《雅思词汇真经》去重核心词表”，不要标成出版社核定全集。优先核对原书第 21 章 favour/startle 附近的 surprising，以及简历与恢复两处 resume；再检查上表四组网络转录冲突。要锁定具体印次并完成原书级验收，仍需该版版权页及对应词表/索引页。
