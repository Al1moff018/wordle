
"use strict";

/* =========================================
   AL1MOFF WORDLE 2.0
   API-BASED VERSION
   ========================================= */

// SETTINGS
const SETTINGS = {
    wordLength: 5,
    maxAttempts: 6,
    hintCost: 30,
    xpPerWin: 20,
    xpPerLevel: 100,
    maxLevel: 5,
    coinsPerWin: 20,
    storageKey: "al1moff_wordle_v2",
    usedWordsKey: "al1moff_used_words",
    randomAPI: "https://random-word-api.herokuapp.com/word",
    dictionaryAPI: "https://wordotron.com/api/v1/check-word"
};

// DOM
const $ = id => document.getElementById(id);

const board = $("board");
const keyboard = $("keyboard");
const message = $("message");

// PLAYER DATA
const DEFAULT_DATA = {
    xp: 0,
    coins: 0,
    totalCoins: 0,
    wins: 0,
    games: 0,
    streak: 0,
    bestStreak: 0,
    discovered: [],
    achievements: []
};

function loadPlayer() {
    try {
        const saved = JSON.parse(
            localStorage.getItem(SETTINGS.storageKey)
        );

        return {
            ...DEFAULT_DATA,
            ...(saved || {}),
            discovered: Array.isArray(saved?.discovered)
                ? saved.discovered
                : [],
            achievements: Array.isArray(saved?.achievements)
                ? saved.achievements
                : []
        };
    } catch {
        return { ...DEFAULT_DATA };
    }
}

let player = loadPlayer();

// GAME VARIABLES
let usedWords = new Set();

try {
    const savedWords = JSON.parse(
        localStorage.getItem(SETTINGS.usedWordsKey) || "[]"
    );

    if (Array.isArray(savedWords)) {
        usedWords = new Set(savedWords);
    }
} catch {
    usedWords = new Set();
}

let checkedWords = new Map();

let answer = "";
let currentRow = 0;
let currentGuess = Array(5).fill("");
let rowResults = [];
let keyboardStates = {};
let hintPositions = [];

let gameActive = false;
let isChecking = false;
let isStarting = false;

// LEVELS
const LEVELS = {
    1: "Beginner · Start your English journey",
    2: "Explorer · Discover more words",
    3: "Thinker · Challenge your vocabulary",
    4: "Expert · Show your knowledge",
    5: "Master · Reach the top"
};

// =========================================
// SAVE SYSTEM
// =========================================

function savePlayer() {
    localStorage.setItem(
        SETTINGS.storageKey,
        JSON.stringify(player)
    );

    localStorage.setItem(
        SETTINGS.usedWordsKey,
        JSON.stringify([...usedWords])
    );
}

function getLevel() {
    return Math.min(
        SETTINGS.maxLevel,
        Math.floor(player.xp / SETTINGS.xpPerLevel) + 1
    );
}

function getLevelXP() {
    return player.xp % SETTINGS.xpPerLevel;
}

// =========================================
// API REQUEST WITH TIMEOUT
// =========================================

async function requestAPI(url, options = {}) {
    const controller = new AbortController();

    const timeout = setTimeout(
        () => controller.abort(),
        12000
    );

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        return response;

    } finally {
        clearTimeout(timeout);
    }
}

// =========================================
// CHECK ENGLISH WORD
// =========================================

async function isValidWord(word) {
    word = word.trim().toLowerCase();

    if (!/^[a-z]{5}$/.test(word)) {
        return false;
    }

    if (checkedWords.has(word)) {
        return checkedWords.get(word);
    }

    const response = await requestAPI(
        SETTINGS.dictionaryAPI,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ word })
        }
    );

    const data = await response.json();

    if (typeof data.valid !== "boolean") {
        throw new Error("Unexpected dictionary response.");
    }

    checkedWords.set(word, data.valid);

    return data.valid;
}

// =========================================
// GET RANDOM WORD
// =========================================

async function getRandomWord() {
    for (let attempt = 0; attempt < 25; attempt++) {
        const url =
            `${SETTINGS.randomAPI}?number=1&length=5`;

        const response = await requestAPI(url);
        const words = await response.json();

        if (!Array.isArray(words) || words.length === 0) {
            continue;
        }

        const word = String(words[0]).toLowerCase();

        if (!/^[a-z]{5}$/.test(word)) {
            continue;
        }

        if (usedWords.has(word)) {
            continue;
        }

        const valid = await isValidWord(word);

        if (!valid) {
            continue;
        }

        usedWords.add(word);
        savePlayer();

        return word.toUpperCase();
    }

    throw new Error(
        "Could not find a new word. Please try again."
    );
}

// =========================================
// BOARD
// =========================================

function buildBoard() {
    board.innerHTML = "";

    for (let row = 0; row < 6; row++) {
        const rowElement = document.createElement("div");
        rowElement.className = "board-row";

        for (let col = 0; col < 5; col++) {
            const tile = document.createElement("div");

            tile.className = "tile";
            tile.id = `tile-${row}-${col}`;

            rowElement.appendChild(tile);
        }

        board.appendChild(rowElement);
    }
}

function renderBoard() {
    for (let row = 0; row < 6; row++) {
        for (let col = 0; col < 5; col++) {
            const tile = $(`tile-${row}-${col}`);

            if (!tile) continue;

            tile.className = "tile";
            tile.style.borderColor = "";

            let letter = "";

            if (row < currentRow && rowResults[row]) {
                letter = rowResults[row].guess[col];

                tile.classList.add(
                    rowResults[row].result[col]
                );

            } else if (row === currentRow && gameActive) {
                letter = currentGuess[col] || "";

                if (letter) {
                    tile.classList.add("filled");
                }

                if (hintPositions.includes(col)) {
                    tile.style.borderColor = "#8b72ff";
                }
            }

            tile.textContent = letter;
        }
    }
}

// =========================================
// KEYBOARD
// =========================================

function buildKeyboard() {
    keyboard.innerHTML = "";

    const rows = [
        "QWERTYUIOP",
        "ASDFGHJKL",
        "ZXCVBNM"
    ];

    rows.forEach((letters, index) => {
        const rowElement = document.createElement("div");
        rowElement.className = "keyboard-row";

        if (index === 2) {
            rowElement.appendChild(
                createKey("ENTER", "wide")
            );
        }

        for (const letter of letters) {
            rowElement.appendChild(createKey(letter));
        }

        if (index === 2) {
            rowElement.appendChild(
                createKey("BACKSPACE", "wide")
            );
        }

        keyboard.appendChild(rowElement);
    });
}

function createKey(value, extraClass = "") {
    const button = document.createElement("button");

    button.type = "button";
    button.className = `key ${extraClass}`;
    button.dataset.key = value;

    button.textContent =
        value === "BACKSPACE" ? "⌫" : value;

    if (keyboardStates[value]) {
        button.classList.add(keyboardStates[value]);
    }

    button.addEventListener("click", () => {
        handleInput(value);
    });

    return button;
}

function updateKeyboard(guess, result) {
    const priority = {
        absent: 1,
        present: 2,
        correct: 3
    };

    for (let i = 0; i < guess.length; i++) {
        const letter = guess[i];
        const newState = result[i];
        const oldState = keyboardStates[letter];

        if (
            !oldState ||
            priority[newState] > priority[oldState]
        ) {
            keyboardStates[letter] = newState;
        }
    }

    buildKeyboard();
}

// =========================================
// INPUT
// =========================================

function handleInput(key) {
    if (!gameActive || isChecking || isStarting) {
        return;
    }

    if (key === "ENTER") {
        submitGuess();
        return;
    }

    if (key === "BACKSPACE") {
        removeLetter();
        return;
    }

    if (/^[A-Z]$/.test(key)) {
        addLetter(key);
    }
}

function addLetter(letter) {
    const emptyIndex = currentGuess.findIndex(
        value => value === ""
    );

    if (emptyIndex === -1) return;

    currentGuess[emptyIndex] = letter;

    renderBoard();
}

function removeLetter() {
    for (let i = 4; i >= 0; i--) {
        if (currentGuess[i] !== "") {
            currentGuess[i] = "";

            hintPositions = hintPositions.filter(
                position => position !== i
            );

            renderBoard();
            return;
        }
    }
}

// =========================================
// WORDLE LOGIC
// =========================================

function evaluateGuess(guess) {
    const result = Array(5).fill("absent");

    const answerLetters = answer.split("");
    const guessLetters = guess.split("");

    // Exact matches
    for (let i = 0; i < 5; i++) {
        if (guessLetters[i] === answerLetters[i]) {
            result[i] = "correct";

            answerLetters[i] = null;
            guessLetters[i] = null;
        }
    }

    // Present letters
    for (let i = 0; i < 5; i++) {
        if (guessLetters[i] === null) continue;

        const foundIndex = answerLetters.indexOf(
            guessLetters[i]
        );

        if (foundIndex !== -1) {
            result[i] = "present";
            answerLetters[foundIndex] = null;
        }
    }

    return result;
}

// =========================================
// SUBMIT GUESS
// =========================================

async function submitGuess() {
    if (!gameActive || isChecking) return;

    if (currentGuess.some(letter => !letter)) {
        showMessage("Enter all 5 letters first.");
        return;
    }

    const guess = currentGuess.join("").toLowerCase();

    isChecking = true;
    showMessage("Checking English dictionary...");

    try {
        const valid = await isValidWord(guess);

        if (!valid) {
            showMessage("This word is not in the dictionary.");
            isChecking = false;
            return;
        }

        const upperGuess = guess.toUpperCase();
        const result = evaluateGuess(upperGuess);
        const won = upperGuess === answer;

        rowResults[currentRow] = {
            guess: upperGuess,
            result
        };

        updateKeyboard(upperGuess, result);

        currentRow++;
        currentGuess = Array(5).fill("");
        hintPositions = [];

        renderBoard();

        isChecking = false;

        if (won) {
            finishGame(true);
            return;
        }

        if (currentRow >= SETTINGS.maxAttempts) {
            finishGame(false);
            return;
        }

        showMessage(
            `${SETTINGS.maxAttempts - currentRow} attempts remaining.`
        );

    } catch (error) {
        console.error(error);

        showMessage(
            "Dictionary API is unavailable. Try again."
        );

        isChecking = false;
    }
}

// =========================================
// HINT SYSTEM
// =========================================

function useHint() {
    if (!gameActive || isChecking || isStarting) return;

    if (player.coins < SETTINGS.hintCost) {
        showMessage("Not enough coins!");
        return;
    }

    const available = [];

    for (let i = 0; i < 5; i++) {
        if (
            currentGuess[i] !== answer[i] &&
            !hintPositions.includes(i)
        ) {
            available.push(i);
        }
    }

    if (available.length === 0) {
        showMessage("All letters are already correct!");
        return;
    }

    const position = available[
        Math.floor(Math.random() * available.length)
    ];

    player.coins -= SETTINGS.hintCost;

    currentGuess[position] = answer[position];
    hintPositions.push(position);

    savePlayer();
    updateStats();
    renderBoard();

    showMessage(
        `Hint: Position ${position + 1} is ${answer[position]}.`
    );
}

// =========================================
// FINISH GAME
// =========================================

function finishGame(won) {
    if (!gameActive) return;

    gameActive = false;

    player.games++;

    let reward = 0;

    if (won) {
        player.wins++;
        player.streak++;

        player.bestStreak = Math.max(
            player.bestStreak,
            player.streak
        );

        if (!player.discovered.includes(answer)) {
            player.discovered.push(answer);
        }

        const bonus = (
            SETTINGS.maxAttempts - currentRow
        ) * 5;

        reward = SETTINGS.coinsPerWin + bonus;

        player.coins += reward;
        player.totalCoins += reward;
        player.xp += SETTINGS.xpPerWin;

    } else {
        player.streak = 0;
    }

    checkAchievements();

    savePlayer();
    updateStats();
    renderHistory();

    $("resultTitle").textContent = won
        ? "🎉 Excellent!"
        : "💪 Keep practicing!";

    $("resultDescription").textContent = won
        ? `You found the word in ${currentRow} attempt(s).`
        : "You used all 6 attempts. Try again!";

    $("resultWord").textContent = answer;

    $("rewardText").textContent = won
        ? `+${reward} coins · +${SETTINGS.xpPerWin} XP`
        : "No rewards this time.";

    $("resultModal").classList.add("show");

    if ($("hintBtn")) {
        $("hintBtn").disabled = true;
    }
}

// =========================================
// ACHIEVEMENTS
// =========================================

function checkAchievements() {
    const achievements = [
        ["first_win", player.wins >= 1],
        ["five_wins", player.wins >= 5],
        ["ten_wins", player.wins >= 10],
        ["streak_3", player.bestStreak >= 3],
        ["streak_5", player.bestStreak >= 5],
        ["word_collector", player.discovered.length >= 25],
        ["master", getLevel() >= 5]
    ];

    achievements.forEach(([id, condition]) => {
        if (
            condition &&
            !player.achievements.includes(id)
        ) {
            player.achievements.push(id);
            showMessage(`Achievement unlocked: ${id}!`);
        }
    });
}

// =========================================
// STATISTICS
// =========================================

function updateStats() {
    const level = getLevel();
    const xp = getLevelXP();

    const rate = player.games
        ? Math.round(player.wins / player.games * 100)
        : 0;

    if ($("levelValue")) {
        $("levelValue").textContent = level;
    }

    if ($("levelBadge")) {
        $("levelBadge").textContent = `LEVEL ${level}`;
    }

    if ($("levelDescription")) {
        $("levelDescription").textContent =
            LEVELS[level];
    }

    if ($("xpProgress")) {
        $("xpProgress").style.width = `${xp}%`;
    }

    if ($("xpText")) {
        $("xpText").textContent =
            `${xp} / ${SETTINGS.xpPerLevel} XP`;
    }

    if ($("winsValue")) {
        $("winsValue").textContent = player.wins;
    }

    if ($("streakValue")) {
        $("streakValue").textContent = player.streak;
    }

    if ($("coinHeader")) {
        $("coinHeader").textContent = player.coins;
    }

    if ($("gamesValue")) {
        $("gamesValue").textContent = player.games;
    }

    if ($("rateValue")) {
        $("rateValue").textContent = `${rate}%`;
    }

    if ($("earnedValue")) {
        $("earnedValue").textContent = player.totalCoins;
    }

    if ($("remainingValue")) {
        $("remainingValue").textContent =
            "Unlimited API words";
    }
}

// =========================================
// DISCOVERED WORDS
// =========================================

function renderHistory() {
    const history = $("history");

    if (!history) return;

    history.innerHTML = "";

    if (!player.discovered.length) {
        const empty = document.createElement("p");
        empty.textContent = "No words discovered yet.";
        history.appendChild(empty);
        return;
    }

    player.discovered
        .slice()
        .reverse()
        .forEach(word => {
            const item = document.createElement("span");

            item.className = "history-item";
            item.textContent = word;

            history.appendChild(item);
        });
}

// =========================================
// START GAME
// =========================================

async function startGame() {
    if (isStarting) return;

    isStarting = true;
    gameActive = false;

    showMessage("Choosing a new English word...");

    try {
        const newAnswer = await getRandomWord();

        answer = newAnswer;

        currentRow = 0;
        currentGuess = Array(5).fill("");
        rowResults = [];
        keyboardStates = {};
        hintPositions = [];

        buildBoard();
        buildKeyboard();

        gameActive = true;

        renderBoard();
        updateStats();

        $("resultModal")?.classList.remove("show");

        if ($("hintBtn")) {
            $("hintBtn").disabled = false;
        }

        showMessage("New word selected. Good luck!");

    } catch (error) {
        console.error(error);

        showMessage(
            "Could not get a new word. Check your internet and retry."
        );

    } finally {
        isStarting = false;
    }
}

// =========================================
// NEW GAME
// =========================================

async function newGame() {
    if (isStarting) return;

    if (gameActive) {
        const confirmed = confirm(
            "Start a new game? This round will count as a loss."
        );

        if (!confirmed) return;

        player.games++;
        player.streak = 0;

        savePlayer();
    }

    await startGame();
}

// =========================================
// RESET PROGRESS
// =========================================

function resetProgress() {
    const confirmed = confirm(
        "Delete all progress, coins and discovered words?"
    );

    if (!confirmed) return;

    player = { ...DEFAULT_DATA };

    usedWords.clear();
    checkedWords.clear();

    savePlayer();

    renderHistory();
    updateStats();

    startGame();
}

// =========================================
// MESSAGES
// =========================================

function showMessage(text) {
    if (message) {
        message.textContent = text;
    }
}

// =========================================
// PHYSICAL KEYBOARD
// =========================================

document.addEventListener("keydown", event => {
    if (
        !gameActive ||
        isChecking ||
        isStarting ||
        $("resultModal")?.classList.contains("show")
    ) {
        return;
    }

    if (event.ctrlKey || event.altKey || event.metaKey) {
        return;
    }

    if (event.key === "Enter") {
        event.preventDefault();
        handleInput("ENTER");

    } else if (event.key === "Backspace") {
        event.preventDefault();
        handleInput("BACKSPACE");

    } else if (/^[a-zA-Z]$/.test(event.key)) {
        handleInput(event.key.toUpperCase());
    }
});

// =========================================
// BUTTON EVENTS
// =========================================

$("hintBtn")?.addEventListener("click", useHint);

$("newGameBtn")?.addEventListener("click", newGame);

$("continueBtn")?.addEventListener("click", startGame);

$("resetStats")?.addEventListener("click", resetProgress);

// =========================================
// INITIALIZATION
// =========================================

function initializeGame() {
    buildBoard();
    buildKeyboard();

    updateStats();
    renderHistory();

    startGame();
}

initializeGame();
