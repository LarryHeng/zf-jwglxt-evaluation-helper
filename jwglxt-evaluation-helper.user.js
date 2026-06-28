// ==UserScript==
// @name         正方学生评价自动填写助手
// @namespace    https://github.com/LarryHeng/zf-jwglxt-evaluation-helper
// @version      2.3.0
// @author       LarryHeng
// @license      MIT
// @description  面向正方 jwglxt 学生评价页面的自动填写辅助脚本，只跳转一个未评课程并填写当前页，不自动保存，不自动提交。
// @homepageURL  https://github.com/LarryHeng/zf-jwglxt-evaluation-helper?tab=readme-ov-file
// @supportURL   https://github.com/LarryHeng/zf-jwglxt-evaluation-helper/issues
// @match        *://*/jwglxt/*
// @match        *://*/*xspj*
// @match        *://*/*Xspj*
// @match        *://*/*N401605*
// @run-at       document-idle
// @grant        unsafeWindow
// ==/UserScript==

(function () {

    const PROJECT_META = {
        name: '正方学生评价自动填写助手',
        author: 'LarryHeng',
        version: '2.3.0',
        createdAt: '2026-06',
        storagePrefix: 'larryheng_zf_jwglxt_evaluation_helper'
    };

    const config = {
        targetScore: 100,
        scoreStep: 5,

        fillOnlyEmpty: true,
        skipSubmittedCourses: true,
        skipSavedCourses: true,

        waitAfterSelectMs: 1600,
        waitPanelTimeoutMs: 9000,
        itemFillDelayMs: 320,
        afterPageFillDelayMs: 700
    };

    let taskRunning = false;
    let stopRequested = false;

    const ui = {
        panel: null,
        jumpBtn: null,
        currentBtn: null,
        stopBtn: null,
        debugBtn: null
    };

    const usageStats = {
        storageKey: PROJECT_META.storagePrefix + '_usage_stats_v23',

        defaultData: {
            fillPageCount: 0,
            jumpRunCount: 0,
            fillCurrentRunCount: 0,
            filledCourseCount: 0,
            filledItemCount: 0,
            failedScoreCheckCount: 0,
            firstUsedAt: '',
            lastUsedAt: ''
        },

        load() {
            try {
                const raw = localStorage.getItem(this.storageKey);

                if (!raw) {
                    return Object.assign({}, this.defaultData);
                }

                return Object.assign({}, this.defaultData, JSON.parse(raw));
            } catch (e) {
                return Object.assign({}, this.defaultData);
            }
        },

        save(data) {
            const now = new Date().toISOString();

            if (!data.firstUsedAt) {
                data.firstUsedAt = now;
            }

            data.lastUsedAt = now;
            localStorage.setItem(this.storageKey, JSON.stringify(data));
        },

        inc(key, amount) {
            const data = this.load();

            if (typeof data[key] !== 'number') {
                data[key] = 0;
            }

            data[key] += amount || 1;
            this.save(data);
            this.render();

            return data[key];
        },

        addFillResult(result) {
            if (!result) {
                return;
            }

            let itemCount = 0;

            for (const key in result) {
                if (Object.prototype.hasOwnProperty.call(result, key)) {
                    itemCount += Number(result[key] || 0);
                }
            }

            this.inc('fillPageCount', 1);
            this.inc('filledItemCount', itemCount);
        },

        getEstimatedMinutesSaved() {
            const data = this.load();
            return data.filledCourseCount * 3;
        },

        reset() {
            localStorage.removeItem(this.storageKey);
            this.render();
        },

        render() {
            const box = document.querySelector('#xspj_usage_stats_box');

            if (!box) {
                return;
            }

            const data = this.load();

            box.innerHTML =
                '<div style="font-weight:600;margin-bottom:4px;">本机使用统计</div>' +
                '<div>跳转填写：' + data.jumpRunCount + ' 次</div>' +
                '<div>当前页填写：' + data.fillCurrentRunCount + ' 次</div>' +
                '<div>自动填写页数：' + data.fillPageCount + ' 次</div>' +
                '<div>已填写课程：' + data.filledCourseCount + ' 门</div>' +
                '<div>已填写评价项：' + data.filledItemCount + ' 条</div>' +
                '<div>填写校验失败：' + data.failedScoreCheckCount + ' 次</div>' +
                '<div>预计节省：' + this.getEstimatedMinutesSaved() + ' 分钟</div>';
        }
    };

    function pageWindow() {
        try {
            if (typeof unsafeWindow !== 'undefined' && unsafeWindow) {
                return unsafeWindow;
            }
        } catch (e) {}

        return window;
    }

    function pageDocument() {
        try {
            const win = pageWindow();

            if (win && win.document) {
                return win.document;
            }
        } catch (e) {}

        return document;
    }

    function addUnique(list, item) {
        if (!item) {
            return;
        }

        for (let i = 0; i < list.length; i++) {
            if (list[i] === item) {
                return;
            }
        }

        list.push(item);
    }

    function getDocCandidates() {
        const docs = [];

        try {
            addUnique(docs, document);
        } catch (e) {}

        try {
            addUnique(docs, pageDocument());
        } catch (e) {}

        try {
            addUnique(docs, window.document);
        } catch (e) {}

        try {
            addUnique(docs, window.parent.document);
        } catch (e) {}

        try {
            addUnique(docs, window.top.document);
        } catch (e) {}

        try {
            const win = pageWindow();
            addUnique(docs, win.document);
            addUnique(docs, win.parent.document);
            addUnique(docs, win.top.document);
        } catch (e) {}

        return docs;
    }

    function qOne(selector) {
        try {
            const direct = document.querySelector(selector);

            if (direct) {
                return direct;
            }
        } catch (e) {}

        try {
            const directPage = pageDocument().querySelector(selector);

            if (directPage) {
                return directPage;
            }
        } catch (e) {}

        const docs = getDocCandidates();

        for (let i = 0; i < docs.length; i++) {
            try {
                const el = docs[i].querySelector(selector);

                if (el) {
                    return el;
                }
            } catch (e) {}
        }

        return null;
    }

    function toArray(nodeList) {
        const arr = [];

        if (!nodeList) {
            return arr;
        }

        for (let i = 0; i < nodeList.length; i++) {
            arr.push(nodeList[i]);
        }

        return arr;
    }

    function qAll(selector, root) {
        const base = root || pageDocument();

        try {
            return toArray(base.querySelectorAll(selector));
        } catch (e) {
            return [];
        }
    }

    function sleep(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    async function waitOneItem() {
        await sleep(config.itemFillDelayMs);
    }

    function getJquery() {
        try {
            const win = pageWindow();

            if (win && win.jQuery) {
                return win.jQuery;
            }
        } catch (e) {}

        try {
            if (window.jQuery) {
                return window.jQuery;
            }
        } catch (e) {}

        return null;
    }

    function getJqueryForElement(el) {
        if (!el || !el.ownerDocument || !el.ownerDocument.defaultView) {
            return getJquery();
        }

        return el.ownerDocument.defaultView.jQuery || getJquery();
    }

    function getPanelRoot() {
        return qOne('#panel_content');
    }

    function setButtonDisabled(button, disabled) {
        if (!button) {
            return;
        }

        button.disabled = disabled;
        button.style.opacity = disabled ? '0.55' : '1';
        button.style.cursor = disabled ? 'not-allowed' : 'pointer';
    }

    function refreshButtonState() {
        const disabled = taskRunning;

        setButtonDisabled(ui.jumpBtn, disabled);
        setButtonDisabled(ui.currentBtn, disabled);
        setButtonDisabled(ui.debugBtn, disabled);
        setButtonDisabled(ui.stopBtn, false);
    }

    function setTaskRunning(running) {
        taskRunning = running;
        refreshButtonState();
    }

    function isTargetPage() {
        return Boolean(
            qOne('#gnmkdmKey[value="N401605"]') ||
            location.href.indexOf('xspj') >= 0 ||
            location.href.indexOf('Xspj') >= 0 ||
            location.href.indexOf('N401605') >= 0
        );
    }

    function fireEvent(el, eventName) {
        if (!el) {
            return;
        }

        el.dispatchEvent(new Event(eventName, {
            bubbles: true,
            cancelable: true
        }));
    }

    function clickLikeUser(el) {
        if (!el) {
            return;
        }

        const win = el.ownerDocument && el.ownerDocument.defaultView ? el.ownerDocument.defaultView : window;
        const names = ['pointerdown', 'mousedown', 'mouseup', 'click'];

        for (let i = 0; i < names.length; i++) {
            try {
                el.dispatchEvent(new MouseEvent(names[i], {
                    bubbles: true,
                    cancelable: true,
                    view: win
                }));
            } catch (e) {}
        }

        try {
            el.click();
        } catch (e) {}
    }

    function isDisabled(el) {
        if (!el) {
            return true;
        }

        return el.disabled || el.readOnly || el.getAttribute('aria-disabled') === 'true';
    }

    function getText(el) {
        if (!el) {
            return '';
        }

        return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function getCustomComment() {
        const input = document.querySelector('#xspj_comment_text');

        if (!input) {
            return '';
        }

        return String(input.value || '').trim();
    }

    function getTargetScore() {
        const input = document.querySelector('#xspj_target_score');
        let value = input ? Number(input.value) : Number(config.targetScore);

        if (!Number.isFinite(value)) {
            value = 100;
        }

        value = Math.max(0, Math.min(100, value));
        value = Math.round(value / config.scoreStep) * config.scoreStep;

        config.targetScore = value;

        if (input) {
            input.value = String(value);
        }

        return value;
    }

    function validateTargetScore() {
        const score = getTargetScore();

        if (score % config.scoreStep !== 0) {
            showStatus('分数必须按 ' + config.scoreStep + ' 分递增。');
            return false;
        }

        if (score < 0 || score > 100) {
            showStatus('分数必须在 0 到 100 之间。');
            return false;
        }

        return true;
    }

    function getEvaluationRows(root) {
        const rows = [];

        if (!root || typeof root.querySelectorAll !== 'function') {
            return rows;
        }

        const nodeList = root.querySelectorAll('tr.tr-xspj');

        for (let i = 0; i < nodeList.length; i++) {
            const row = nodeList[i];

            if (row && typeof row.querySelector === 'function') {
                rows.push(row);
            }
        }

        return rows;
    }

    function getRowCheckedRadio(row) {
        if (!row || typeof row.querySelector !== 'function') {
            return null;
        }

        return row.querySelector('input.radio-pjf:checked, input[type="radio"]:checked');
    }

    function getAvailableRadios(row) {
        const radios = [];

        if (!row || typeof row.querySelectorAll !== 'function') {
            return radios;
        }

        const nodeList = row.querySelectorAll('input.radio-pjf, input[type="radio"]');

        for (let i = 0; i < nodeList.length; i++) {
            const radio = nodeList[i];

            if (!radio || isDisabled(radio)) {
                continue;
            }

            const dyf = Number(radio.getAttribute('data-dyf'));

            if (!Number.isFinite(dyf)) {
                continue;
            }

            radios.push({
                radio: radio,
                score: dyf
            });
        }

        return radios;
    }

    function getRowTargetRadio(row, score) {
        const items = getAvailableRadios(row);

        if (!items.length) {
            return {
                radio: null,
                actualScore: null,
                mode: 'none'
            };
        }

        let exact = null;
        let bestLower = null;
        let lowest = null;
        let highest = null;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];

            if (item.score === score) {
                exact = item;
                break;
            }

            if (item.score <= score) {
                if (!bestLower || item.score > bestLower.score) {
                    bestLower = item;
                }
            }

            if (!lowest || item.score < lowest.score) {
                lowest = item;
            }

            if (!highest || item.score > highest.score) {
                highest = item;
            }
        }

        if (exact) {
            return {
                radio: exact.radio,
                actualScore: exact.score,
                mode: 'exact'
            };
        }

        if (bestLower) {
            return {
                radio: bestLower.radio,
                actualScore: bestLower.score,
                mode: 'lower'
            };
        }

        if (lowest) {
            return {
                radio: lowest.radio,
                actualScore: lowest.score,
                mode: 'lowest'
            };
        }

        if (highest) {
            return {
                radio: highest.radio,
                actualScore: highest.score,
                mode: 'highest'
            };
        }

        return {
            radio: null,
            actualScore: null,
            mode: 'none'
        };
    }

    function countFillTargets(root) {
        let total = 0;
        const rows = getEvaluationRows(root);

        if (rows.length) {
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];

                if (!config.fillOnlyEmpty) {
                    total++;
                    continue;
                }

                if (!getRowCheckedRadio(row)) {
                    total++;
                }
            }

            return total;
        }

        const radioNames = {};
        const radios = qAll('input[type="radio"]', root);

        for (let i = 0; i < radios.length; i++) {
            const el = radios[i];

            if (!el || isDisabled(el)) {
                continue;
            }

            const key = el.name || el.id || ('anonymous_' + i);

            if (!el.checked) {
                radioNames[key] = true;
            }
        }

        return Object.keys(radioNames).length;
    }

    function sumFillResult(result) {
        let total = 0;

        if (!result) {
            return total;
        }

        for (const key in result) {
            if (Object.prototype.hasOwnProperty.call(result, key)) {
                total += Number(result[key] || 0);
            }
        }

        return total;
    }

    function updateProgress(current, total, message) {
        const progressText = document.querySelector('#xspj_progress_text');
        const progressBar = document.querySelector('#xspj_progress_bar');
        const percent = total > 0 ? Math.round((current / total) * 100) : 0;

        if (progressText) {
            progressText.textContent = message || ('当前页已填写 ' + current + '/' + total);
        }

        if (progressBar) {
            progressBar.style.width = percent + '%';
        }
    }

    function updateBatchProgress(message) {
        const batchText = document.querySelector('#xspj_batch_progress_text');

        if (batchText) {
            batchText.textContent = message || '单次跳转填写模式';
        }
    }

    function showStatus(message) {
        const box = document.querySelector('#xspj_autofill_status');

        if (box) {
            box.textContent = message;
        }
    }

    function getFinalScoreFromCheck(check) {
        if (!check || !check.rowCount) {
            return 0;
        }

        return Math.round((check.scoreSum / check.rowCount) * 100) / 100;
    }

    function updateScoreCheckBox(check) {
        const box = document.querySelector('#xspj_score_check_box');

        if (!box) {
            return;
        }

        if (!check) {
            box.innerHTML =
                '<div style="font-weight:600;margin-bottom:4px;">当前页校验</div>' +
                '<div>等待填写后显示校验后分数。</div>';
            return;
        }

        const finalScore = getFinalScoreFromCheck(check);
        const scoreColor = check.all100 ? '#0a8a0a' : '#d00000';
        const okColor = check.ok ? '#0a8a0a' : '#d00000';
        const scoreText = check.scoreText || '暂无';

        box.innerHTML =
            '<div style="font-weight:600;margin-bottom:4px;">当前页校验</div>' +
            '<div style="font-size:18px;font-weight:700;color:' + scoreColor + ';margin-bottom:4px;">校验后分数：' + finalScore + '</div>' +
            '<div>选择状态：<span style="font-weight:600;color:' + okColor + ';">' + (check.ok ? '已选完' : '未选完') + '</span></div>' +
            '<div>评价项：<span style="font-weight:600;">' + check.checkedCount + '/' + check.rowCount + '</span></div>' +
            '<div>分数分布：<span style="font-weight:600;">' + scoreText + '</span></div>';
    }

    function getEmptyRadioCheck(message) {
        return {
            ok: false,
            allChecked: false,
            all100: false,
            checkedCount: 0,
            rowCount: 0,
            full100Count: 0,
            scoreSum: 0,
            scoreText: '',
            message: message || '未找到评价项。'
        };
    }

    function getRadioCompletionCheck() {
        const root = getPanelRoot();

        if (!root) {
            return getEmptyRadioCheck('没有找到评价内容区域。');
        }

        const rows = getEvaluationRows(root);

        if (!rows.length) {
            return getEmptyRadioCheck('当前评价区没有找到 tr.tr-xspj。');
        }

        let checkedCount = 0;
        let full100Count = 0;
        let scoreSum = 0;
        const scoreCounter = {};

        for (let i = 0; i < rows.length; i++) {
            const checked = getRowCheckedRadio(rows[i]);

            if (!checked) {
                continue;
            }

            checkedCount++;

            const score = Number(checked.getAttribute('data-dyf'));

            if (Number.isFinite(score)) {
                scoreCounter[String(score)] = (scoreCounter[String(score)] || 0) + 1;
                scoreSum += score;
            }

            if (score === 100) {
                full100Count++;
            }
        }

        let scoreText = '';

        for (const key in scoreCounter) {
            if (Object.prototype.hasOwnProperty.call(scoreCounter, key)) {
                if (scoreText) {
                    scoreText += '，';
                }

                scoreText += key + '分×' + scoreCounter[key];
            }
        }

        const allChecked = checkedCount === rows.length;
        const all100 = full100Count === rows.length;

        return {
            ok: allChecked,
            allChecked: allChecked,
            all100: all100,
            checkedCount: checkedCount,
            rowCount: rows.length,
            full100Count: full100Count,
            scoreSum: scoreSum,
            scoreText: scoreText,
            message: allChecked ? '已完成选择：' + checkedCount + '/' + rows.length + '。' : '仍有未选择项：' + checkedCount + '/' + rows.length + '。'
        };
    }

    function fillCheckPass() {
        return getRadioCompletionCheck();
    }

    async function fillEvaluationRows(root, progress) {
        const targetScore = getTargetScore();
        const rows = getEvaluationRows(root);
        let count = 0;
        let firstActualScore = null;

        for (let i = 0; i < rows.length; i++) {
            if (stopRequested) {
                break;
            }

            const row = rows[i];

            if (!row || typeof row.querySelector !== 'function') {
                continue;
            }

            if (config.fillOnlyEmpty && getRowCheckedRadio(row)) {
                continue;
            }

            const choice = getRowTargetRadio(row, targetScore);
            const target = choice.radio;

            if (!target) {
                showStatus('第 ' + (i + 1) + ' 行没有找到可用选项。');
                continue;
            }

            if (firstActualScore === null) {
                firstActualScore = choice.actualScore;
            }

            try {
                row.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center'
                });
            } catch (e) {}

            target.checked = true;
            clickLikeUser(target);
            fireEvent(target, 'input');
            fireEvent(target, 'change');

            const label = target.closest('label');

            if (label) {
                clickLikeUser(label);
            }

            const $ = getJqueryForElement(target);

            if ($) {
                try {
                    $(target).prop('checked', true);
                    $(target).trigger('click');
                    $(target).trigger('change');
                    $(row).removeClass('wpjzb');
                    $(row).trigger('change');
                } catch (e) {}
            }

            try {
                row.classList.remove('wpjzb');
            } catch (e) {}

            count++;
            progress.current++;

            let msg = '当前页已填写 ' + progress.current + '/' + progress.total;

            if (choice.actualScore !== targetScore) {
                msg += '，目标' + targetScore + '，实际选择' + choice.actualScore;
            }

            updateProgress(progress.current, progress.total, msg);

            await waitOneItem();
        }

        if (firstActualScore !== null && firstActualScore !== targetScore) {
            showStatus('目标分 ' + targetScore + ' 没有精确档位，已按可用档位选择。');
        }

        return count;
    }

    async function fillFallbackRadios(root, progress) {
        const targetScore = getTargetScore();
        const radios = qAll('input[type="radio"]', root);
        const groups = {};
        let count = 0;

        for (let i = 0; i < radios.length; i++) {
            const radio = radios[i];

            if (!radio) {
                continue;
            }

            const key = radio.name || radio.id || ('anonymous_' + i);

            if (!groups[key]) {
                groups[key] = [];
            }

            groups[key].push(radio);
        }

        for (const key in groups) {
            if (!Object.prototype.hasOwnProperty.call(groups, key)) {
                continue;
            }

            if (stopRequested) {
                break;
            }

            const items = groups[key];
            let alreadyChecked = false;

            for (let i = 0; i < items.length; i++) {
                if (items[i].checked) {
                    alreadyChecked = true;
                    break;
                }
            }

            if (config.fillOnlyEmpty && alreadyChecked) {
                continue;
            }

            let target = null;
            let bestLower = null;
            let lowest = null;

            for (let i = 0; i < items.length; i++) {
                const score = Number(items[i].getAttribute('data-dyf'));

                if (!Number.isFinite(score)) {
                    continue;
                }

                if (score === targetScore) {
                    target = items[i];
                    break;
                }

                if (score <= targetScore) {
                    if (!bestLower || score > Number(bestLower.getAttribute('data-dyf'))) {
                        bestLower = items[i];
                    }
                }

                if (!lowest || score < Number(lowest.getAttribute('data-dyf'))) {
                    lowest = items[i];
                }
            }

            if (!target) {
                target = bestLower || lowest || items[0];
            }

            if (!target) {
                continue;
            }

            target.checked = true;
            clickLikeUser(target);
            fireEvent(target, 'input');
            fireEvent(target, 'change');

            count++;
            progress.current++;
            updateProgress(progress.current, progress.total, '当前页已填写 ' + progress.current + '/' + progress.total);

            await waitOneItem();
        }

        return count;
    }

    async function fillTextInputs(root, progress) {
        const comment = getCustomComment();

        if (!comment) {
            return 0;
        }

        const inputs = qAll('textarea, input[type="text"]', root);
        let count = 0;

        for (let i = 0; i < inputs.length; i++) {
            if (stopRequested) {
                break;
            }

            const el = inputs[i];

            if (!el || isDisabled(el)) {
                continue;
            }

            if (config.fillOnlyEmpty && el.value.trim()) {
                continue;
            }

            const sign = [el.name, el.id, el.className, el.placeholder].join(' ');
            const looksLikeScore = /分|score|pf|cj|成绩|评价分数/i.test(sign);

            if (looksLikeScore) {
                continue;
            }

            el.value = comment;

            fireEvent(el, 'input');
            fireEvent(el, 'change');

            count++;
            progress.current++;
            updateProgress(progress.current, progress.total, '当前页已填写 ' + progress.current + '/' + progress.total);

            await waitOneItem();
        }

        return count;
    }

    async function fillCurrentPageCore() {
        const root = getPanelRoot();

        if (!root) {
            debugPage();
            showStatus('没有找到评价内容区域。诊断结果已输出到控制台。');
            updateScoreCheckBox(getEmptyRadioCheck('没有找到评价内容区域。'));
            return null;
        }

        if (!validateTargetScore()) {
            return null;
        }

        const progress = {
            current: 0,
            total: countFillTargets(root)
        };

        updateProgress(0, progress.total, '当前页已填写 0/' + progress.total);
        showStatus('开始逐项填写当前页。');

        const rows = getEvaluationRows(root);

        const result = {
            evaluationRows: rows.length ? await fillEvaluationRows(root, progress) : 0,
            fallbackRadios: rows.length ? 0 : await fillFallbackRadios(root, progress),
            text: await fillTextInputs(root, progress)
        };

        await sleep(config.afterPageFillDelayMs);

        usageStats.addFillResult(result);

        const total = sumFillResult(result);
        const check = getRadioCompletionCheck();

        updateScoreCheckBox(check);
        updateProgress(progress.current, progress.total, '当前页填写完成 ' + progress.current + '/' + progress.total);
        showStatus('已尝试填写 ' + total + ' 项。' + check.message + ' 校验后分数：' + getFinalScoreFromCheck(check));

        console.log('[学生评价自动填写助手] 填写结果', {
            result: result,
            check: check,
            finalScore: getFinalScoreFromCheck(check)
        });

        return {
            result: result,
            check: check
        };
    }

    async function fillCurrentPageNoSave(labelText) {
        const fillResult = await fillCurrentPageCore();

        if (!fillResult) {
            showStatus((labelText || '当前页') + '填写失败。脚本未保存。');
            return {
                ok: false,
                filled: false,
                filledCount: 0,
                message: '填写失败'
            };
        }

        const filledCount = sumFillResult(fillResult.result);

        await sleep(500);

        const check = fillCheckPass();
        const finalScore = getFinalScoreFromCheck(check);

        updateScoreCheckBox(check);

        if (!check.ok) {
            usageStats.inc('failedScoreCheckCount', 1);
            showStatus((labelText || '当前页') + '已填写 ' + filledCount + ' 项，但仍有未选择项：' + check.message + '。校验后分数：' + finalScore + '。脚本未保存。');

            return {
                ok: false,
                filled: false,
                filledCount: filledCount,
                finalScore: finalScore,
                message: check.message
            };
        }

        usageStats.inc('filledCourseCount', 1);
        showStatus((labelText || '当前页') + '已自动填写完成，本次填写 ' + filledCount + ' 项，校验后分数：' + finalScore + '。脚本已停止，请手动点击教务系统原生保存按钮。');

        return {
            ok: true,
            filled: true,
            filledCount: filledCount,
            finalScore: finalScore,
            message: '已填写，未保存'
        };
    }

    function cssEscape(value) {
        try {
            const win = pageWindow();

            if (win.CSS && typeof win.CSS.escape === 'function') {
                return win.CSS.escape(String(value));
            }
        } catch (e) {}

        return String(value).replace(/([ #;?%&,.+*~':"!^$[\]()=>|/@])/g, '\\$1');
    }

    function getCellText(row, field) {
        if (!row || typeof row.querySelector !== 'function') {
            return '';
        }

        const cell = row.querySelector('[aria-describedby="tempGrid_' + field + '"]');

        if (!cell) {
            return '';
        }

        return (cell.getAttribute('title') || cell.innerText || '').trim();
    }

    function makeCourseEntryFromRow(row, source) {
        return {
            source: source || 'dom',
            id: row.id,
            row: row,
            doc: row.ownerDocument,
            status: getCellText(row, 'tjztmc'),
            teacher: getCellText(row, 'jzgmc'),
            course: getCellText(row, 'kcmc'),
            className: getCellText(row, 'jxbmc'),
            score: getCellText(row, 'bfzpf')
        };
    }

    function makeCourseEntryFromJqGridData(id, data, doc) {
        return {
            source: 'jqgrid',
            id: id,
            row: doc.querySelector('#' + cssEscape(id)),
            doc: doc,
            status: data.tjztmc || '',
            teacher: data.jzgmc || '',
            course: data.kcmc || '',
            className: data.jxbmc || '',
            score: data.bfzpf || ''
        };
    }

    function getCourseEntriesFromDom(doc) {
        const entries = [];

        if (!doc || typeof doc.querySelector !== 'function') {
            return entries;
        }

        const grid = doc.querySelector('#tempGrid');

        if (!grid) {
            return entries;
        }

        const nodeList = grid.querySelectorAll('tr.jqgrow, tr[role="row"]');

        for (let i = 0; i < nodeList.length; i++) {
            const row = nodeList[i];

            if (!row || !row.id) {
                continue;
            }

            if (row.classList && row.classList.contains('jqgfirstrow')) {
                continue;
            }

            if (!getText(row)) {
                continue;
            }

            entries.push(makeCourseEntryFromRow(row, 'dom'));
        }

        return entries;
    }

    function getCourseEntriesFromJqGrid(doc) {
        const entries = [];
        const $ = getJquery();

        if (!$ || !doc || !doc.querySelector('#tempGrid')) {
            return entries;
        }

        try {
            const ids = $('#tempGrid').jqGrid('getDataIDs') || [];

            for (let i = 0; i < ids.length; i++) {
                const id = ids[i];
                let data = {};

                try {
                    data = $('#tempGrid').jqGrid('getRowData', id) || {};
                } catch (e) {
                    data = {};
                }

                entries.push(makeCourseEntryFromJqGridData(id, data, doc));
            }
        } catch (e) {}

        return entries;
    }

    function getCourseEntries() {
        const docs = getDocCandidates();
        const all = [];

        for (let i = 0; i < docs.length; i++) {
            const domEntries = getCourseEntriesFromDom(docs[i]);

            for (let j = 0; j < domEntries.length; j++) {
                all.push(domEntries[j]);
            }
        }

        if (all.length) {
            return all;
        }

        for (let i = 0; i < docs.length; i++) {
            const apiEntries = getCourseEntriesFromJqGrid(docs[i]);

            for (let j = 0; j < apiEntries.length; j++) {
                all.push(apiEntries[j]);
            }
        }

        return all;
    }

    function getSelectedCourseEntry() {
        const entries = getCourseEntries();

        for (let i = 0; i < entries.length; i++) {
            const row = entries[i].row;

            if (!row) {
                continue;
            }

            const selectedByClass = row.classList && row.classList.contains('ui-state-highlight');
            const selectedByAria = row.getAttribute('aria-selected') === 'true';
            const selectedByTab = row.getAttribute('tabindex') === '0';

            if (selectedByClass || selectedByAria || selectedByTab) {
                return entries[i];
            }
        }

        return null;
    }

    function isNeedFillCourseEntry(entry) {
        if (!entry) {
            return false;
        }

        const status = String(entry.status || '');
        const score = String(entry.score || '').trim();

        if (config.skipSubmittedCourses && status.indexOf('提交') >= 0) {
            return false;
        }

        if (config.skipSavedCourses && status.indexOf('保存') >= 0) {
            return false;
        }

        if (status.indexOf('未评') >= 0) {
            return true;
        }

        if (!score) {
            return true;
        }

        return false;
    }

    function shouldProcessCourse(entry) {
        return isNeedFillCourseEntry(entry);
    }

    async function selectCourseEntry(entry) {
        if (!entry) {
            return;
        }

        if (entry.row) {
            try {
                entry.row.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center'
                });
            } catch (e) {}
        }

        const $ = getJquery();

        if ($ && $.fn && $.fn.jqGrid && entry.id) {
            try {
                $('#tempGrid').jqGrid('setSelection', entry.id, true);
            } catch (e) {}
        }

        if (entry.row) {
            clickLikeUser(entry.row);
        }

        await sleep(config.waitAfterSelectMs);
    }

    async function waitPanelAfterSelect() {
        const start = Date.now();

        while (Date.now() - start < config.waitPanelTimeoutMs) {
            const root = getPanelRoot();
            const hasContent = root && (
                getEvaluationRows(root).length > 0 ||
                qAll('input.radio-pjf, input[type="radio"], textarea, input[type="text"]', root).length > 0
            );

            if (hasContent) {
                await sleep(500);
                return true;
            }

            await sleep(300);
        }

        return false;
    }

    async function fillCurrentSelectedCourseNoSave() {
        if (taskRunning) {
            showStatus('当前已有任务正在执行。');
            return;
        }

        usageStats.inc('fillCurrentRunCount', 1);
        stopRequested = false;
        setTaskRunning(true);

        try {
            await fillCurrentPageNoSave('当前页');
        } finally {
            setTaskRunning(false);
        }
    }

    async function jumpToUnratedAndFillCurrent() {
        if (taskRunning) {
            showStatus('当前已有任务正在执行。');
            return;
        }

        if (!validateTargetScore()) {
            return;
        }

        usageStats.inc('jumpRunCount', 1);
        stopRequested = false;
        setTaskRunning(true);

        try {
            const entries = getCourseEntries();

            if (!entries.length) {
                const root = getPanelRoot();

                if (root && getEvaluationRows(root).length) {
                    showStatus('没有读取到左侧课程列表，改为填写当前右侧评价页。脚本不会保存。');
                    await fillCurrentPageNoSave('当前页');
                    return;
                }

                debugPage();
                showStatus('没有找到左侧课程列表。诊断结果已输出到控制台。');
                return;
            }

            let targetEntry = null;

            for (let i = 0; i < entries.length; i++) {
                if (shouldProcessCourse(entries[i])) {
                    targetEntry = entries[i];
                    break;
                }
            }

            if (!targetEntry) {
                const root = getPanelRoot();

                if (root && getEvaluationRows(root).length) {
                    const check = getRadioCompletionCheck();
                    updateScoreCheckBox(check);

                    if (!check.ok) {
                        showStatus('没有筛到未评课程，改为填写当前右侧评价页。脚本不会保存。');
                        await fillCurrentPageNoSave('当前页');
                        return;
                    }
                }

                showStatus('当前课程表没有找到未评价课程。可能都已经保存或提交。');
                return;
            }

            const title = targetEntry.course + ' ' + targetEntry.teacher;

            showStatus('正在跳转到未评课程：' + title);
            updateBatchProgress('准备填写：' + title);
            updateProgress(0, 0, '等待加载当前课程');
            updateScoreCheckBox(null);

            console.log('[学生评价自动填写助手] 跳转到未评课程', targetEntry);

            await selectCourseEntry(targetEntry);

            const panelReady = await waitPanelAfterSelect();

            if (!panelReady) {
                showStatus('未评课程页面加载失败，请手动点该课程后再试。');
                return;
            }

            const result = await fillCurrentPageNoSave(title);

            if (result.filled) {
                showStatus(title + ' 已填写完成，本次填写 ' + result.filledCount + ' 项，校验后分数：' + result.finalScore + '。脚本已停止，请手动保存。保存后再点按钮处理下一门。');
                updateBatchProgress('已填写一个未评课程，等待手动保存');
            } else {
                showStatus(title + ' 填写未完成：' + result.message + '。脚本未保存。');
            }
        } finally {
            setTaskRunning(false);
        }
    }

    function stopTask() {
        stopRequested = true;
        showStatus('已请求停止。当前小步骤结束后会停下。');
    }

    function debugPage() {
        const docs = getDocCandidates();
        const result = [];

        for (let i = 0; i < docs.length; i++) {
            const doc = docs[i];
            const root = doc.querySelector('#panel_content');
            const grid = doc.querySelector('#tempGrid');

            const item = {
                docIndex: i,
                href: doc.location ? doc.location.href : '',
                title: doc.title,
                hasPanelContent: Boolean(root),
                panelRows: root ? root.querySelectorAll('tr.tr-xspj').length : 0,
                radioPjfCount: root ? root.querySelectorAll('input.radio-pjf').length : 0,
                targetRadioCount: root ? root.querySelectorAll('input.radio-pjf[data-dyf="' + getTargetScore() + '"]').length : 0,
                checkedRadioCount: root ? root.querySelectorAll('input.radio-pjf:checked').length : 0,
                hasTempGrid: Boolean(grid),
                domCourseRows: grid ? getCourseEntriesFromDom(doc).length : 0,
                jqGridCourseRows: grid ? getCourseEntriesFromJqGrid(doc).length : 0,
                selectedCourse: getSelectedCourseEntry()
            };

            result.push(item);
        }

        const check = getRadioCompletionCheck();
        updateScoreCheckBox(check);

        console.log('[学生评价自动填写助手] 页面诊断结果', result);

        let summary = '';

        for (let i = 0; i < result.length; i++) {
            const item = result[i];

            summary += 'doc' + item.docIndex +
                '：panel=' + item.hasPanelContent +
                '，评价行=' + item.panelRows +
                '，radio=' + item.radioPjfCount +
                '，目标radio=' + item.targetRadioCount +
                '，已选=' + item.checkedRadioCount +
                '，grid=' + item.hasTempGrid +
                '，DOM课程=' + item.domCourseRows +
                '，API课程=' + item.jqGridCourseRows;

            if (i < result.length - 1) {
                summary += '\n';
            }
        }

        showStatus('页面诊断完成。' + summary);
        console.log('[学生评价自动填写助手] 诊断摘要', summary);

        return result;
    }

    function createButton(text, background, color) {
        const btn = document.createElement('button');

        btn.textContent = text;
        btn.type = 'button';
        btn.style.width = '100%';
        btn.style.height = '32px';
        btn.style.marginTop = '8px';
        btn.style.border = background === '#1677ff' || background === '#d00000' ? '0' : '1px solid #bbb';
        btn.style.borderRadius = '6px';
        btn.style.background = background;
        btn.style.color = color;
        btn.style.cursor = 'pointer';
        btn.style.fontSize = '13px';

        return btn;
    }

    function createProgressBox() {
        const wrap = document.createElement('div');
        wrap.id = 'xspj_progress_wrap';
        wrap.style.marginTop = '10px';
        wrap.style.padding = '8px';
        wrap.style.background = '#f7f7f7';
        wrap.style.border = '1px solid #eee';
        wrap.style.borderRadius = '6px';
        wrap.style.fontSize = '12px';
        wrap.style.color = '#333';

        const batchText = document.createElement('div');
        batchText.id = 'xspj_batch_progress_text';
        batchText.textContent = '单次跳转填写模式';
        batchText.style.marginBottom = '6px';

        const text = document.createElement('div');
        text.id = 'xspj_progress_text';
        text.textContent = '当前页已填写 0/0';
        text.style.marginBottom = '6px';

        const barOuter = document.createElement('div');
        barOuter.style.width = '100%';
        barOuter.style.height = '8px';
        barOuter.style.background = '#e5e5e5';
        barOuter.style.borderRadius = '8px';
        barOuter.style.overflow = 'hidden';

        const barInner = document.createElement('div');
        barInner.id = 'xspj_progress_bar';
        barInner.style.width = '0%';
        barInner.style.height = '100%';
        barInner.style.background = '#1677ff';
        barInner.style.transition = 'width .18s linear';

        const scoreBox = document.createElement('div');
        scoreBox.id = 'xspj_score_check_box';
        scoreBox.style.marginTop = '8px';
        scoreBox.style.padding = '8px';
        scoreBox.style.background = '#fff';
        scoreBox.style.border = '1px solid #e6e6e6';
        scoreBox.style.borderRadius = '6px';
        scoreBox.style.lineHeight = '1.6';
        scoreBox.style.color = '#333';
        scoreBox.innerHTML =
            '<div style="font-weight:600;margin-bottom:4px;">当前页校验</div>' +
            '<div>等待填写后显示校验后分数。</div>';

        barOuter.appendChild(barInner);
        wrap.appendChild(batchText);
        wrap.appendChild(text);
        wrap.appendChild(barOuter);
        wrap.appendChild(scoreBox);

        return wrap;
    }

    function createPanel() {
        if (document.querySelector('#xspj_autofill_panel')) {
            return;
        }

        const panel = document.createElement('div');
        panel.id = 'xspj_autofill_panel';
        panel.style.position = 'fixed';
        panel.style.right = '18px';
        panel.style.top = '120px';
        panel.style.zIndex = '999999';
        panel.style.width = '240px';
        panel.style.padding = '12px';
        panel.style.background = '#fff';
        panel.style.border = '1px solid #ddd';
        panel.style.borderRadius = '8px';
        panel.style.boxShadow = '0 4px 16px rgba(0,0,0,.18)';
        panel.style.fontSize = '13px';
        panel.style.color = '#333';

        const title = document.createElement('div');
        title.textContent = PROJECT_META.name;
        title.style.fontWeight = '600';
        title.style.marginBottom = '4px';

        const authorLine = document.createElement('div');
        authorLine.textContent = '作者：' + PROJECT_META.author + ' · v' + PROJECT_META.version;
        authorLine.style.fontSize = '12px';
        authorLine.style.color = '#666';
        authorLine.style.marginBottom = '8px';

        const scoreWrap = document.createElement('div');
        scoreWrap.style.display = 'flex';
        scoreWrap.style.alignItems = 'center';
        scoreWrap.style.gap = '6px';
        scoreWrap.style.marginBottom = '8px';

        const scoreLabel = document.createElement('label');
        scoreLabel.textContent = '目标分';
        scoreLabel.style.fontSize = '12px';
        scoreLabel.style.color = '#333';

        const scoreInput = document.createElement('input');
        scoreInput.id = 'xspj_target_score';
        scoreInput.type = 'number';
        scoreInput.min = '0';
        scoreInput.max = '100';
        scoreInput.step = String(config.scoreStep);
        scoreInput.value = String(config.targetScore);
        scoreInput.style.flex = '1';
        scoreInput.style.height = '28px';
        scoreInput.style.boxSizing = 'border-box';
        scoreInput.style.border = '1px solid #ccc';
        scoreInput.style.borderRadius = '5px';
        scoreInput.style.padding = '0 6px';

        scoreInput.addEventListener('change', function () {
            getTargetScore();
            showStatus('目标分已设为 ' + config.targetScore + '。没有精确档位时会选不高于目标分的最高档。');
        });

        scoreWrap.appendChild(scoreLabel);
        scoreWrap.appendChild(scoreInput);

        const commentLabel = document.createElement('div');
        commentLabel.textContent = '可选评语，留空不填';
        commentLabel.style.fontSize = '12px';
        commentLabel.style.color = '#666';
        commentLabel.style.marginBottom = '4px';

        const commentInput = document.createElement('textarea');
        commentInput.id = 'xspj_comment_text';
        commentInput.placeholder = '留空则不自动写评语';
        commentInput.style.width = '100%';
        commentInput.style.height = '48px';
        commentInput.style.boxSizing = 'border-box';
        commentInput.style.border = '1px solid #ccc';
        commentInput.style.borderRadius = '5px';
        commentInput.style.padding = '6px';
        commentInput.style.resize = 'vertical';
        commentInput.style.fontSize = '12px';

        const jumpBtn = createButton('1. 跳到未评并填写当前页', '#1677ff', '#fff');
        jumpBtn.onclick = jumpToUnratedAndFillCurrent;

        const currentBtn = createButton('2. 只填写当前页', '#1677ff', '#fff');
        currentBtn.onclick = fillCurrentSelectedCourseNoSave;

        const stopBtn = createButton('3. 停止任务', '#f7f7f7', '#333');
        stopBtn.onclick = stopTask;

        const debugBtn = createButton('4. 页面诊断', '#f7f7f7', '#333');
        debugBtn.onclick = debugPage;

        const progressBox = createProgressBox();

        const statusBox = document.createElement('div');
        statusBox.id = 'xspj_autofill_status';
        statusBox.textContent = '已加载。点击“1. 跳到未评并填写当前页”后，只会处理一个未评课程，填完立即停止，不会自动保存或提交。校验后分数会显示在进度条下方。';
        statusBox.style.marginTop = '8px';
        statusBox.style.fontSize = '12px';
        statusBox.style.lineHeight = '1.5';
        statusBox.style.color = '#333';

        const statsBox = document.createElement('div');
        statsBox.id = 'xspj_usage_stats_box';
        statsBox.style.marginTop = '10px';
        statsBox.style.padding = '8px';
        statsBox.style.background = '#f7f7f7';
        statsBox.style.border = '1px solid #eee';
        statsBox.style.borderRadius = '6px';
        statsBox.style.fontSize = '12px';
        statsBox.style.lineHeight = '1.6';
        statsBox.style.color = '#333';

        const note = document.createElement('div');
        note.textContent = '流程：跳到未评课程 → 自动填写当前页 → 查看校验后分数 → 脚本停止 → 你手动保存。保存后再点按钮处理下一门。';
        note.style.marginTop = '8px';
        note.style.fontSize = '12px';
        note.style.color = '#666';
        note.style.lineHeight = '1.5';

        ui.panel = panel;
        ui.jumpBtn = jumpBtn;
        ui.currentBtn = currentBtn;
        ui.stopBtn = stopBtn;
        ui.debugBtn = debugBtn;

        panel.appendChild(title);
        panel.appendChild(authorLine);
        panel.appendChild(scoreWrap);
        panel.appendChild(commentLabel);
        panel.appendChild(commentInput);
        panel.appendChild(jumpBtn);
        panel.appendChild(currentBtn);
        panel.appendChild(stopBtn);
        panel.appendChild(debugBtn);
        panel.appendChild(progressBox);
        panel.appendChild(statusBox);
        panel.appendChild(statsBox);
        panel.appendChild(note);

        document.body.appendChild(panel);

        usageStats.render();
        refreshButtonState();
        updateScoreCheckBox(null);

        window.__xspjAutofill = {
            jumpAndFill: jumpToUnratedAndFillCurrent,
            fillCurrent: fillCurrentSelectedCourseNoSave,
            stop: stopTask,
            debug: debugPage,
            stats: usageStats,
            config: config,
            meta: PROJECT_META
        };
    }

    function init() {
        if (!isTargetPage()) {
            return;
        }

        createPanel();
    }

    setTimeout(init, 800);
})();