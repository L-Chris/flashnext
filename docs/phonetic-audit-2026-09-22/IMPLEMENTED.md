# 音标规范化实施记录

2026-09-22。已实施默认英音的学习词典风格 IPA，保留原始数据和旧值。规则通过的候选不等于全部经过人工逐词审核；特殊词的显式校订与自动规范化分开记录。

## 变更

- 新增 `word_pronunciations`：保存来源、快照 SHA、词性、用法提示、地区、原始及展示音标、接受/待核验状态；Word 保存原音标与展示规范版本。
- Kaikki 全量候选 98,163 条，按宽式、口音、词形、备注和符号规则筛选；保留不确定记录，禁止从美音字符替换推测英音。
- 对 teacher、bird、read、resume、bow、permit 保留独立人工校订。read 时态、resume 名词/动词、bow 同形异义分别展示；permit 错位的名词候选不参与展示。
- 统一词表和复习页音标展示，多读音可展开查看用法；未统一的旧值在数据层保留待核验状态；按用户要求，前端只显示音标，不显示核验提示。美音原始候选仍保留，尚未提供经核验的美音切换功能。
- IELTS 章节只有与已接受候选唯一对应时才更新；bow 按既有章节释义映射，其他歧义保留原值及标记。
- 停止 COCA 导入用旧 CMU→KK 转换作为主音标，更新已有词时不再覆盖音标；IELTS 重复用法导入也保护音标。新词暂用 legacy 值，经过同一候选流程再批准。
- 迁移只修改精确匹配系统生成内容的卡背；已有人工修改保留。ensureCards 的同步也不再无条件覆盖卡背。

## 验证与迁移

- Python 规则测试：宽/窄式、地区、变体/限定信息、弱元音、重音位置。
- 数据库副本完整导入两次，第二次词、卡片、章节用法变更均为 0，发音记录 ID 不变；专门加入的自定义笔记保留。
- 副本及生产迁移均对比原有各表，除音标字段和允许的系统卡背外，所有列保持不变；外键、SQLite 完整性检查通过。
- 服务端 typecheck、前端 typecheck/build、Docker 构建通过。
- 生产备份及旧镜像标识见 `deployment-state.json`；逐词变更见 `production-migration.json`；保护字段验证见 `production-verification.json`。
- 按用户要求执行 `docker builder prune -a -f`，清理构建缓存，工具报告释放 18.53 GB；未删除运行容器、镜像或数据卷。

## 后续导入命令

以下步骤先在数据库副本完成；`--apply` 才会修改数据库。生产执行前暂停写入并备份。

```sh
python3 server/scripts/prepare-pronunciations.py \
  --db /absolute/path/to/copy.db \
  --output server/scripts/data/pronunciations-v1.json

python3 server/scripts/import-pronunciations.py \
  --db /absolute/path/to/copy.db \
  --input server/scripts/data/pronunciations-v1.json \
  --report /absolute/path/to/diff.json

# 审核差异后加 --apply；先 prisma db push 更新副本 schema。
```

脚本需要主机 Python 3；当前应用镜像未安装 Python，因此此流程在主机运行。原始快照和候选文件位于被 Git 忽略的数据目录。更新 Kaikki 快照或规则时必须重新生成候选；不能把当前 8,144 词推广为其他快照的覆盖率。

## 回滚

需要撤回本次整批更新时，停止应用，将 `deployment-state.json` 中的 SQLite 备份恢复到数据目录，并使用其中记录的旧镜像启动。恢复整个备份会丢失备份之后的新学习记录，因此用户恢复学习后，应优先利用 phonetic_legacy 和逐词变更报告做字段级回滚，不能直接覆盖整库。
