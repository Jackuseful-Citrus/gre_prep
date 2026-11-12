"""Rebuild delivery reports from the delivered bank and existing QA artifacts.

Run: python scripts/generate_delivery_report.py
This script never modifies question data, source documents or saved progress.
"""
from __future__ import annotations

import hashlib
import json
from collections import Counter
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "reports"


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def origins(question):
    result = {question["source_id"]}
    for ref in question.get("source_refs", []):
        source_id = ref.get("source_id") or ref.get("sourceId")
        if source_id:
            result.add(source_id)
    return result


def metrics(questions):
    return {
        "count": len(questions),
        "mapped_standard_answer_count": sum(bool(q.get("correct_answer")) for q in questions),
        "gradable_count": sum(bool(q.get("gradable")) for q in questions),
        "explanation_or_guidance_count": sum(any(q.get(k) for k in ("explanation", "guidance", "model_essay", "explanation_images")) for q in questions),
        "text_explanation_or_guidance_count": sum(any(q.get(k) for k in ("explanation", "guidance", "model_essay")) for q in questions),
        "explanation_image_count": sum(bool(q.get("explanation_images")) for q in questions),
        "unverified_count": sum(q.get("answer_status") != "verified" for q in questions),
        "raw_answer_count": sum(bool(q.get("raw_answer")) for q in questions),
        "raw_answer_without_mapped_key_count": sum(bool(q.get("raw_answer")) and not q.get("correct_answer") for q in questions),
        "answer_status_counts": dict(Counter(q["answer_status"] for q in questions)),
    }


def browser_result(path):
    data = read(path)
    results = data["results"]
    assert results and all(r["ok"] for r in results), str(path)
    assert not data.get("pageErrors"), str(path)
    return {
        "artifact": str(path.relative_to(ROOT)).replace("\\", "/"),
        "tested_at": data.get("testedAt", data.get("checkedAt")),
        "passed": sum(bool(r["ok"]) for r in results),
        "total": len(results),
        "page_error_count": len(data.get("pageErrors", [])),
        "bank_count": data.get("bankCount", data.get("stats", {}).get("questions")),
        "local_assets_checked": data.get("localAssetsChecked"),
    }


def main():
    bank_path = ROOT / "gre_question_bank.json"
    bank_hash = digest(bank_path)
    bank = read(bank_path)
    questions = bank["questions"]
    sources = {s["id"]: s for s in bank["sources"]}
    quality = read(REPORTS / "gre_quality_report.json")
    inventory = read(ROOT / "gre_library_inventory.json")
    acceptance = read(REPORTS / "platform-data-acceptance.json")
    assert acceptance["passed"] and acceptance["failure_count"] == 0
    assert acceptance["question_count"] == len(questions)
    assert acceptance["source_count"] == len(sources)
    assert quality["total"] == len(questions)
    assert not bank["pending_sources"]

    type_stats = []
    for existing in bank["statistics"]:
        kind = existing["type"]
        rows = [q for q in questions if q["question_type"] == kind]
        counted = metrics(rows)
        for old, new in (("count", "count"), ("with_answer", "mapped_standard_answer_count"), ("gradable", "gradable_count"), ("with_explanation", "text_explanation_or_guidance_count"), ("unverified", "unverified_count")):
            assert existing[old] == counted[new], (kind, old)
        origin_ids = set().union(*(origins(q) for q in rows))
        assert origin_ids <= sources.keys(), (kind, origin_ids - sources.keys())
        ordered_ids = [sid for sid in sources if sid in origin_ids]
        type_stats.append({
            "question_type": kind, "title": existing["title"],
            "category": rows[0]["category"], **counted,
            "source_ids": ordered_ids,
            "source_names": [sources[sid]["title"] for sid in ordered_ids],
            "standard_answer_applicable": rows[0]["category"] != "AWA",
        })
    assert {s["question_type"] for s in type_stats} == {q["question_type"] for q in questions}
    assert sum(s["count"] for s in type_stats) == len(questions)

    source_stats = []
    for sid, source in sources.items():
        associated = [q for q in questions if sid in origins(q)]
        primary = [q for q in questions if q["source_id"] == sid]
        source_stats.append({
            "source_id": sid, "title": source["title"],
            "source_file": source.get("source_file", source.get("fileName")),
            "local_url": source.get("url", source.get("reader", {}).get("url")),
            "source_pages": source.get("pages"),
            "retained_questions_as_primary_source": len(primary),
            "retained_questions_with_any_origin_reference": len(associated),
            "question_types": sorted({q["question_type"] for q in associated}),
            "notes": source.get("notes", []),
        })
    assert sum(s["retained_questions_as_primary_source"] for s in source_stats) == len(questions)

    supplemental_types = {"QuantRecall", "QuantDrill", "TC_LEGACY", "Issue", "Argument"}
    boundaries = {
        "standard_question_structure_count": sum(q["question_type"] not in supplemental_types for q in questions),
        "legacy_paired_choice_tc_count": sum(q["question_type"] == "TC_LEGACY" for q in questions),
        "quant_recall_count": sum(q["question_type"] == "QuantRecall" for q in questions),
        "quant_drill_count": sum(q["question_type"] == "QuantDrill" for q in questions),
        "awa_prompt_count": sum(q["category"] == "AWA" for q in questions),
    }
    assert sum(boundaries.values()) == len(questions)
    platform_qa = browser_result(ROOT / "tests" / "platform-qa-report.json")
    rc_qa = browser_result(ROOT / "tests" / "app-qa-report.json")
    assert platform_qa["bank_count"] == len(questions)
    assert rc_qa["bank_count"] == quality["legacy_rc_questions_preserved"]

    limitations = [
        "强化36套：定位到755条答案/解析记录，未找到完整英文题干及选项，未冒充755道可练题；保留原PDF入口及缺失说明。原资料标称756题，不能按书名补齐。",
        "220页《GRE写作高频题目及考点精析最新版黑皮书陈琦颜余真.pdf》为扫描版，没有可用文字层；未可靠结构化题目，保留原页入口，未猜测题数。",
        "415页《GRE写作逐题解析(1).pdf》的中文字库映射损坏；可定位的320个英文题段已按原文提取并关联原页，乱码指导未静默修复。a56、a74、a79三段题干存在乱码/拼接问题，仅保留原页；同为415页的《GRE写作题库全解析(新2020版).pdf》提取文本重复，单独保留来源而不重复造题。",
        "皇冠阅读、皇冠填空及张巍填空等本地资料未附完整答案。只有严格同题且原答案可靠映射时才关联已存在的答案；剩余题记录练习而不自动计分。未上网索取、猜测或生成答案。",
        "基础24套答案册与正文解析存在32处答案版本冲突，另有52处无法完整交叉核验；保留原键候选与出处，相关题不自动计分。统一去重遇到其他答案冲突也保留候选，并禁止后续正确键覆盖冲突状态。",
        "GWC填空1500原PDF明确标注Section 132缺第10题，实际1499题；该节异常答案行不强行映射。T1–T200另有Bonus，实际201题。材料标题数字不作为补题依据。",
        "QuantRecall是315条回忆题自由作答，QuantDrill是108条原书明确不采用GRE考试格式的知识练习，均不自动评分；它们与810道QC/数学单选/数学多选/数值填空/DI分别统计。",
        "数学原图保留公式、图表及希腊字母。raw_answer只是原答案文本；π、根式等未能安全映射的原答案允许查看和记笔记，不被当作可评分标准键。",
        "TC_LEGACY保留13道2010年旧版成对选项题，一次选择一个完整词对；没有错误拆成现代双空的独立选项。",
        "AWA的Issue与Argument均为本地资料中的写作训练提示；范文、指导和提取状态不是唯一标准答案，不进行自动作文判分。旧资料题型与难度标签按来源保留。",
        "数学思维导图、数学词汇、六选二对应词表、方法页及不完整图片题作为原页参考资料保留，不计作已结构化可评分试题。扫描/乱码/题干缺失仍是明确的数据限制，pending_sources为空仅表示导入流水线已处理完毕。",
        "原始提取文本、PDF和答案出处保留；verified仅表示内容结构与本地原答案映射通过校验，不保证原书答案本身绝对正确，也不表示题目经过ETS官方真题认证。",
    ]
    copied = []
    for filename in (
        "inventory-awa.json", "inventory-quant.json", "inventory-verbal.json",
        "awa-quality-report.json", "awa-validation.json", "quant-quality-report.json",
        "verbal-import-report.json", "verbal-validation.json", "gre_library_inventory.json",
        "gre_library_inventory.xlsx",
    ):
        path = REPORTS / filename
        assert path.exists(), filename
        copied.append({"file": "reports/" + filename, "bytes": path.stat().st_size, "sha256": digest(path)})

    totals = {**metrics(questions), "source_count": len(sources), "question_type_count": len(type_stats),
              "merged_duplicate_count": len(quality["duplicates"]),
              "merged_duplicate_methods": dict(Counter(d["method"] for d in quality["duplicates"])),
              "legacy_rc_preserved_count": quality["legacy_rc_questions_preserved"],
              "reference_material_count": len(bank["reference_materials"]),
              "passage_or_shared_material_count": len(bank["materials"])}
    report = {
        "report_schema_version": 1,
        "generated_at": datetime.now(timezone(timedelta(hours=8))).isoformat(),
        "bank_file": "gre_question_bank.json", "bank_sha256": bank_hash,
        "totals": totals,
        "inventory_scope": inventory["summary"],
        "counting_definitions": {
            "mapped_standard_answer_count": "correct_answer有非空的原答案映射，按题计数；多空/六选二不按答案个数重复计数。仍可能因冲突而禁止评分。",
            "gradable_count": "gradable=true；要求verified及完整合法标准键，且不是AWA。",
            "raw_answer_count": "存在原文答案raw_answer，不等于已经映射的correct_answer，也不等于可评分。",
            "explanation_or_guidance_count": "explanation、guidance、model_essay或explanation_images至少一项非空，按题去重计数；不代表每条均有逐步完整解析。",
            "unverified_count": "answer_status不为verified；AWA无唯一标准答案，此项描述其提取状态，不能解释成缺少正确选项。",
            "source_counts": "主来源计数之和等于题库总数；关联来源计数包含合并前出处，跨来源重叠，不能相加充当总题数。",
            "standard_question_structure_count": "使用标准题型交互结构的条目数量；不代表全部为经官方核验的考试真题。",
            "specialist_reports": "专项库存/质量/验证报告保留各提取阶段的原始数量，可能为统一去重前；最终交付数量以本报告与gre_question_bank.json为准。",
        },
        "type_statistics": type_stats,
        "category_statistics": [{"category": c, **metrics([q for q in questions if q["category"] == c])} for c in ("Verbal", "Quant", "AWA")],
        "training_boundaries": boundaries,
        "source_statistics": source_stats,
        "limitations_and_unstructured_materials": limitations,
        "original_reference_materials": bank["reference_materials"],
        "validation": {
            "platform_browser": platform_qa, "legacy_rc_browser": rc_qa,
            "data_acceptance": {"artifact": "reports/platform-data-acceptance.json", "passed": acceptance["passed"],
                                "failure_count": acceptance["failure_count"], "question_count": acceptance["question_count"],
                                "image_files_checked": acceptance["image_files_checked"],
                                "questions_with_explanation_images": acceptance["questions_with_explanation_images"],
                                "pdf_files_checked": acceptance["pdf_files_checked"]},
            "original_material_hashes_unchanged": acceptance["checks"]["original_material_hash_preserved"],
            "legacy_baseline_hash_checks_passed": acceptance["checks"]["legacy_hash_preserved"],
        },
        "copied_specialist_reports": copied,
        "reproduction_command": "python scripts/generate_delivery_report.py",
        "data_modified_by_report_generation": False,
    }

    lines = [
        "阅间 · GRE 综合训练平台 升级交付报告",
        "生成时间：" + report["generated_at"],
        "统计依据：gre_question_bank.json；SHA256：" + bank_hash,
        "",
        "一、交付范围与计数口径",
        f"最终题库 {len(questions)} 题，{len(sources)} 个来源记录，{len(type_stats)} 种题型。原有 RC 的 {totals['legacy_rc_preserved_count']} 个题目 ID、题文、原键和文章关联保留。",
        "第一阶段扫描覆盖62个原始资料文件、45个压缩包成员；含既有提取文本/JSON等派生文件共149个文件。三个口径不同，不能相加作为题目数量。",
        f"本轮统一合并 {totals['merged_duplicate_count']} 条重复题：严格内容与结构一致499条，逐题原图确认的数学重复6条；重复来源和原键保留。原RC先前合并记录仍保留，不重复算入本轮505条。",
        f"mapped标准答案 {totals['mapped_standard_answer_count']} 题，可自动评分 {totals['gradable_count']} 题，含解析/指导/范文/解析图 {totals['explanation_or_guidance_count']} 题，未达到verified状态 {totals['unverified_count']} 题。",
        f"raw_answer原文答案 {totals['raw_answer_count']} 题，其中 {totals['raw_answer_without_mapped_key_count']} 题没有映射标准键。raw_answer不等于correct_answer，不等于可评分答案。",
        f"含原图解析 {totals['explanation_image_count']} 题，已计入解析/指导总数；一题的文字与图像不重复计数。",
        "mapped标准答案仅表示原资料答案已映射为选项ID或数值格式；冲突/不完整记录即使保留键也不能评分。AWA没有唯一标准答案，mapped与可评分均为0。",
        "未核验口径：answer_status不为verified；包括extracted、needs_review、incomplete。AWA此列说明提取状态，不能理解为缺少标准选项。",
        "",
        "二、每种题型（数量 / mapped标准答案 / 可评分 / 解析或指导 / 未核验）",
    ]
    for s in type_stats:
        lines.append(f"{s['title']} [{s['question_type']}]：{s['count']} / {s['mapped_standard_answer_count']} / {s['gradable_count']} / {s['explanation_or_guidance_count']} / {s['unverified_count']}")
        lines.append("  来源：" + "；".join(s["source_names"]))
    lines.extend([
        "",
        "三、训练类型边界",
        f"采用RC、TC、SE和标准数学题型结构的题目：{boundaries['standard_question_structure_count']}。另列旧版成对选项填空13题、数学回忆自答315题、数学知识练习108题、AWA写作528题，合计10348题。",
        "Quant标准题型共810题，与QuantRecall及QuantDrill分开统计；后两种保留自由作答、原图及出处，不自动评分。AWA按Issue238与Argument290分别练习，无自动标准答案评分。",
        "资料标题、年份、机构名与现行考试真题资格不是同一概念；本项目不虚构真题认证或缺失答案。",
        "",
        "四、来源目录（主来源题数；含合并出处的关联题数）",
    ])
    for s in source_stats:
        lines.append(f"[{s['source_id']}] {s['title']}：{s['retained_questions_as_primary_source']}；{s['retained_questions_with_any_origin_reference']}")
        lines.append("  原文件：" + str(s["source_file"]) + "；本地入口：" + str(s["local_url"]))
    lines.extend([
        "主来源题数总和10348；关联题数跨来源重叠，不可相加。0题来源仍可承载答案册、解析、扫描本、重复版本或参考资料。",
        "",
        "五、已知限制、未结构化部分及数据质量",
    ])
    lines.extend(f"{i}. {item}" for i, item in enumerate(limitations, 1))
    lines.extend([
        "",
        "六、已执行验证",
        f"综合平台浏览器功能检查：{platform_qa['passed']}/{platform_qa['total']}通过，报告{platform_qa['artifact']}；测试时间{platform_qa['tested_at']}。",
        f"原RC浏览器回归：{rc_qa['passed']}/{rc_qa['total']}通过，报告{rc_qa['artifact']}；测试时间{rc_qa['tested_at']}。",
        f"综合浏览器检查覆盖离线file://启动、随机练习、题型交互、整题评分、延迟答案、计时结束、筛选、移动端、学习记录、RC迁移/导入、AWA草稿与历史版本。检查{platform_qa['local_assets_checked']}个本地资产路径，浏览器未捕获运行错误。",
        f"独立数据验收：{acceptance['failure_count']}失败；逐题检查全部输入题保留/去重映射、题型/每空答案结构、来源及页码、冲突不评分、统计完整性。",
        f"图像存在与解码：{acceptance['image_files_checked']}个文件，包含{acceptance['questions_with_explanation_images']}题的explanation_images；PDF检查{acceptance['pdf_files_checked']}个文件。",
        f"原始资料SHA256一致：{acceptance['checks']['original_material_hash_preserved']}项；旧项目基线文件哈希检查{acceptance['checks']['legacy_hash_preserved']}项，包括原data.js/styles.css及词汇项目文件。",
        "数据验收报告：reports/platform-data-acceptance.json；每条断言结果与失败列表可直接查看。",
        "",
        "七、交付文件与复现",
        "双击“打开GRE综合训练.cmd”进入综合平台；旧启动脚本“打开阅读练习.cmd”仍可用，两者均打开dist/index.html。侧栏“原阅读练习器”可进入原阅读界面。也可直接打开dist/index.html。",
        "主题库：gre_question_bank.json；来源清单：gre_library_inventory.xlsx及同名JSON；导入统计：gre_import_report.xlsx。",
        "本报告机器可读版本：reports/gre_delivery_report.json；统一质量与去重记录：reports/gre_quality_report.json。",
        "专项报告已原名复制到reports：" + "、".join(Path(x["file"]).name for x in copied) + "。",
        "专项报告保留提取阶段数量（部分为统一去重前）；最终统计以主题库和本报告为准。reports内gre_library_inventory为阶段1快照，项目根目录同名文件为导入后清单。",
        "平台与来源使用本地静态文件，无需新增后端或外部服务。原材料保留，既有localStorage学习记录通过原RC兼容机制及导入/导出保存。",
        "报告复现：在项目目录运行 python scripts/generate_delivery_report.py；此命令只重建TXT与JSON报告，不更改题库或学习记录。",
    ])
    (ROOT / "升级交付报告.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (REPORTS / "gre_delivery_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    assert digest(bank_path) == bank_hash
    written = read(REPORTS / "gre_delivery_report.json")
    assert written["totals"]["count"] == sum(s["count"] for s in written["type_statistics"]) == len(questions)
    assert written["totals"]["source_count"] == len(written["source_statistics"]) == len(sources)
    assert written["totals"]["merged_duplicate_count"] == len(quality["duplicates"])
    print(json.dumps({"reports_generated": ["升级交付报告.txt", "reports/gre_delivery_report.json"],
                      "questions": len(questions), "sources": len(sources), "duplicates": len(quality["duplicates"]),
                      "mapped_answers": totals["mapped_standard_answer_count"], "gradable": totals["gradable_count"],
                      "explanation_or_guidance": totals["explanation_or_guidance_count"], "unverified": totals["unverified_count"],
                      "bank_sha256_unchanged": bank_hash, "platform_browser_checks": platform_qa["passed"],
                      "rc_browser_checks": rc_qa["passed"], "data_failures": acceptance["failure_count"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
