// --- ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ И КОНСТАНТЫ ---
const DOMElements = {};
document.querySelectorAll('[id]').forEach(el => DOMElements[el.id] = el);

const welcomeMessages = ["Чем я могу помочь?", "Что придумаем сегодня?", "Готов к новым идеям?", "Спросите что-нибудь...", "Как я могу помочь вам сегодня?"];

let activeEditorInfo = { originalNode: null };

let state = {
    currentModel: 'gpt-oss', conversationHistory: [], chats: [], currentChatId: null, isGenerating: false, abortController: null, 
    editingMessageId: null,
    attachedFiles: [],
    settings: { 
        theme: 'system', 
        systemPrompt: '', 
        userName: 'Пользователь', 
        accentColor: '#4a5fc1', 
        // ИЗМЕНЕНИЕ ЗДЕСЬ
        apiKeys: { chatgpt: '', deepseek: '', qwen: '' } 
    }
};

const API_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
// ИЗМЕНЕНИЯ ЗДЕСЬ
const MODEL_NAMES = { 'gpt-oss': 'openai/gpt-oss-20b:free', 'deepseek': 'deepseek/deepseek-chat', 'qwen': 'qwen/qwen2.5-vl-32b-instruct:free' };
const MODEL_KEY_MAP = { 'gpt-oss': 'chatgpt', 'deepseek': 'deepseek', 'qwen': 'qwen' };
const VISION_MODELS = ['qwen'];

// --- ОСНОВНЫЕ ФУНКЦИИ (ИНИЦИАЛИЗАЦИЯ, СОХРАНЕНИЕ) ---
const saveState = () => { localStorage.setItem('chats', JSON.stringify(state.chats)); localStorage.setItem('appSettings', JSON.stringify(state.settings)); };

function loadState() {
    const chats = JSON.parse(localStorage.getItem('chats'));
    const settings = JSON.parse(localStorage.getItem('appSettings'));
    if (chats) state.chats = chats;
    if (settings) {
        state.settings = { ...state.settings, ...settings };
        if (!state.settings.apiKeys) state.settings.apiKeys = { chatgpt: '', deepseek: '', qwen: '' };
    }
}

function init() {
    loadState();
    applySettings();
    if (state.chats.length > 0) { loadChat(state.chats[0].id); } else { prepareNewChatUI(); }
    addEventListeners();
}

// --- УПРАВЛЕНИЕ НАСТРОЙКАМИ И ИНТЕРФЕЙСОМ ---
function updateSystemTheme() {
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.body.classList.toggle('light-theme', systemTheme === 'light');
}

function applySettings() {
    if (state.settings.theme === 'system') {
        updateSystemTheme();
    } else {
        document.body.classList.toggle('light-theme', state.settings.theme === 'light');
    }
    DOMElements.themeSelect.value = state.settings.theme;
    document.documentElement.style.setProperty('--accent-primary', state.settings.accentColor || '#4a5fc1');
    DOMElements.accentColor.value = state.settings.accentColor;
    DOMElements.userNameInput.value = state.settings.userName || 'Пользователь';
    DOMElements.sidebarUserName.textContent = state.settings.userName || 'Пользователь';
    DOMElements.systemPrompt.value = state.settings.systemPrompt;
    DOMElements.apiKey_chatgpt.value = state.settings.apiKeys.chatgpt || '';
    DOMElements.apiKey_deepseek.value = state.settings.apiKeys.deepseek || '';
    // ИЗМЕНЕНИЕ ЗДЕСЬ
    DOMElements.apiKey_qwen.value = state.settings.apiKeys.qwen || '';
}

function saveSettings() {
    state.settings.theme = DOMElements.themeSelect.value;
    state.settings.systemPrompt = DOMElements.systemPrompt.value;
    state.settings.userName = DOMElements.userNameInput.value.trim() || 'Пользователь';
    state.settings.accentColor = DOMElements.accentColor.value.trim() || '#4a5fc1';
    state.settings.apiKeys.chatgpt = DOMElements.apiKey_chatgpt.value.trim();
    state.settings.apiKeys.deepseek = DOMElements.apiKey_deepseek.value.trim();
    // ИЗМЕНЕНИЕ ЗДЕСЬ
    state.settings.apiKeys.qwen = DOMElements.apiKey_qwen.value.trim();
    saveState();
    applySettings();
    toggleSettingsModal(false);
}

const toggleSettingsModal = (show) => { DOMElements.settingsModal.classList.toggle('show', show); DOMElements.sidebarOverlay.classList.toggle('show', show && !DOMElements.sidebar.classList.contains('open')); };

const toggleSidebar = (show) => {
    const isOpen = DOMElements.sidebar.classList.contains('open');
    const shouldShow = typeof show === 'boolean' ? show : !isOpen;
    DOMElements.sidebar.classList.toggle('open', shouldShow);
    if (window.innerWidth < 1024) {
        DOMElements.sidebarOverlay.classList.toggle('show', shouldShow);
    }
};

const scrollToBottom = () => setTimeout(() => DOMElements.main.scrollTop = DOMElements.main.scrollHeight, 100);

// --- УПРАВЛЕНИЕ ЧАТАМИ ---
const prepareNewChatUI = () => {
    state.currentChatId = null; state.conversationHistory = []; DOMElements.chatContainer.innerHTML = '';
    DOMElements.chatContainer.classList.remove('active'); DOMElements.welcomeScreen.classList.remove('hidden');
    DOMElements.welcomeScreen.querySelector('h1').textContent = welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)];
    renderChatsList(); DOMElements.messageInput.value = ''; DOMElements.messageInput.focus();
    clearAttachedFiles();
};

const createNewChat = () => { if (state.isGenerating) return; stopGeneration(); exitEditMode(); prepareNewChatUI(); toggleSidebar(false); };

function loadChat(chatId, maintainScroll = false) {
    if (state.isGenerating) return;
    stopGeneration();
    const chat = state.chats.find(c => c.id === chatId);
    if (!chat) { prepareNewChatUI(); return; }
    
    const mainEl = DOMElements.main;
    const isScrolledToBottom = mainEl.scrollHeight - mainEl.clientHeight <= mainEl.scrollTop + 1;

    state.currentChatId = chatId; state.conversationHistory = chat.messages || []; state.currentModel = chat.model || 'gpt-oss';
    DOMElements.chatContainer.innerHTML = '';
    
    const hasMessages = state.conversationHistory.length > 0;
    DOMElements.welcomeScreen.classList.toggle('hidden', hasMessages); DOMElements.chatContainer.classList.toggle('active', hasMessages);
    
    if (hasMessages) { state.conversationHistory.forEach(msg => addMessageToDOM(msg, true)); }
    
    updateModelDisplay(); renderChatsList(); 
    if (isScrolledToBottom && !maintainScroll) {
        scrollToBottom();
    }
    updateAIActions();
}

function updateCurrentChat() {
    if (!state.currentChatId) return;
    const chat = state.chats.find(c => c.id === state.currentChatId);
    if (chat) {
        chat.messages = state.conversationHistory.map(msg => ({ ...msg }));
        chat.model = state.currentModel; saveState(); renderChatsList();
    }
}

const deleteChat = (chatId) => {
    state.chats = state.chats.filter(c => c.id !== chatId); saveState();
    if (state.currentChatId === chatId) { if (state.chats.length > 0) loadChat(state.chats[0].id); else prepareNewChatUI(); }
    renderChatsList();
};

// --- РЕНДЕРИНГ И UI ---
function renderChatsList() {
    const chatsList = DOMElements.chatsList; chatsList.innerHTML = '';
    const query = DOMElements.chatSearchInput.value.toLowerCase();
    const filteredChats = state.chats.filter(c => c.title.toLowerCase().includes(query));
    if (filteredChats.length === 0) { chatsList.innerHTML = `<div style="text-align: center; color: var(--text-secondary); padding: 20px;">Чатов не найдено</div>`; return; }

    filteredChats.forEach(chat => {
        const chatEl = document.createElement('div');
        chatEl.className = 'chat-item';
        chatEl.classList.toggle('active', chat.id === state.currentChatId);
        chatEl.dataset.chatId = chat.id;
        chatEl.innerHTML = `<span class="chat-item-title">${chat.title}</span><button class="icon-btn delete-chat-btn" title="Удалить чат"><span class="material-symbols-outlined">delete</span></button>`;
        chatEl.addEventListener('click', (e) => {
            if (e.target.closest('.delete-chat-btn')) { 
                e.stopPropagation(); 
                if (confirm(`Вы уверены, что хотите удалить чат "${chat.title}"?`)) deleteChat(chat.id);
            } else { 
                loadChat(chat.id); 
                toggleSidebar(false); 
            }
        });
        chatsList.appendChild(chatEl);
    });
}
const updateModelDisplay = () => {
    const modelNames = { 'gpt-oss': 'ChatGPT', 'deepseek': 'DeepSeek', 'qwen': 'Qwen (Vision)' };
    DOMElements.currentModelName.textContent = modelNames[state.currentModel];
    document.querySelectorAll('.model-option').forEach(opt => opt.classList.toggle('active', opt.dataset.model === state.currentModel));
};
function enhanceCodeBlocks(element) {
    element.querySelectorAll('pre').forEach(pre => {
        if (pre.querySelector('.code-block-header')) return;
        const code = pre.querySelector('code'); if (!code) return;
        const language = code.className.replace('language-', '') || 'code';
        const header = document.createElement('div'); header.className = 'code-block-header';
        const langSpan = document.createElement('span'); langSpan.textContent = language;
        const copyBtn = document.createElement('button'); copyBtn.className = 'copy-code-btn';
        copyBtn.innerHTML = `<span class="material-symbols-outlined">content_copy</span><span>Копировать</span>`;
        copyBtn.addEventListener('click', () => { navigator.clipboard.writeText(code.innerText).then(() => { copyBtn.querySelector('span:last-child').textContent = 'Скопировано!'; setTimeout(() => { copyBtn.querySelector('span:last-child').textContent = 'Копировать'; }, 2000); }); });
        header.appendChild(langSpan); header.appendChild(copyBtn);
        const contentWrapper = document.createElement('div'); contentWrapper.className = 'code-block-content';
        contentWrapper.appendChild(code); pre.innerHTML = ''; pre.appendChild(header); pre.appendChild(contentWrapper);
    });
}
function enhanceTables(element) {
    element.querySelectorAll('table').forEach(table => {
        if (table.parentElement.classList.contains('table-wrapper')) return;
        const wrapper = document.createElement('div');
        wrapper.className = 'table-wrapper';
        table.parentNode.insertBefore(wrapper, table);
        wrapper.appendChild(table);
        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-table-btn';
        copyBtn.innerHTML = `<span class="material-symbols-outlined">table</span><span>Копировать</span>`;
        copyBtn.addEventListener('click', () => {
            const tsvContent = Array.from(table.querySelectorAll('tr')).map(tr => 
                Array.from(tr.querySelectorAll('th, td')).map(td => td.innerText.trim()).join('\t')
            ).join('\n');
            navigator.clipboard.writeText(tsvContent).then(() => {
                copyBtn.querySelector('span:last-child').textContent = 'Скопировано!';
                setTimeout(() => { copyBtn.querySelector('span:last-child').textContent = 'Копировать'; }, 2000);
            });
        });
        wrapper.appendChild(copyBtn);
    });
}

function setSendButtonState() {
    if (state.editingMessageId && window.innerWidth < 1024) {
        DOMElements.sendButton.querySelector('span').textContent = 'check';
        DOMElements.sendButton.classList.remove('stop-generation');
        DOMElements.sendButton.style.display = 'flex';
        DOMElements.micBtn.style.display = 'none';
        return;
    }

    const hasContent = DOMElements.messageInput.value.trim() !== '' || state.attachedFiles.length > 0;
    DOMElements.micBtn.style.display = hasContent ? 'none' : 'flex';
    DOMElements.sendButton.style.display = hasContent ? 'flex' : 'none';
    if (state.isGenerating) {
        DOMElements.sendButton.classList.add('stop-generation');
        DOMElements.sendButton.querySelector('span').textContent = 'stop';
        DOMElements.sendButton.style.display = 'flex';
        DOMElements.micBtn.style.display = 'none';
    } else {
        DOMElements.sendButton.classList.remove('stop-generation');
        DOMElements.sendButton.querySelector('span').textContent = 'arrow_upward';
    }
}

// --- FILE HANDLING LOGIC ---
function renderFilePreviews() {
    DOMElements.filePreviewContainer.innerHTML = '';
    if (state.attachedFiles.length === 0) {
        DOMElements.filePreviewContainer.classList.remove('visible');
        return;
    }
    state.attachedFiles.forEach(file => {
        const previewItem = document.createElement('div');
        previewItem.className = 'file-preview-item';
        previewItem.dataset.fileId = file.id;
        let iconHTML;
        // ИЗМЕНЕНИЕ ЗДЕСЬ: Используем previewUrl для img src
        if (file.fileType === 'image' && file.previewUrl) {
            iconHTML = `<img src="${file.previewUrl}" class="file-preview-img" alt="preview">`;
        } else {
            iconHTML = `<span class="material-symbols-outlined">${file.icon}</span>`;
        }
        previewItem.innerHTML = `
            <div class="file-preview-icon" style="background-color: ${file.iconColor};">
                ${iconHTML}
                <div class="file-loader"></div>
            </div>
            <div class="file-preview-details">
                <span class="file-preview-name">${file.name}</span>
                <span class="file-preview-type">${file.typeDescription}</span>
            </div>
            <button class="icon-btn remove-file-btn" title="Удалить файл"><span class="material-symbols-outlined">close</span></button>
        `;
        previewItem.querySelector('.remove-file-btn').addEventListener('click', () => removeAttachedFile(file.id));
        DOMElements.filePreviewContainer.appendChild(previewItem);
    });
    DOMElements.filePreviewContainer.classList.add('visible');
}

// ИЗМЕНЕНИЕ ЗДЕСЬ: Обновлена логика для обработки изображений в base64
async function handleFileSelect(event) {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;
    if (state.attachedFiles.length + files.length > 10) { alert('Можно прикрепить не более 10 файлов.'); return; }
    for (const file of files) {
        const fileId = Date.now() + Math.random();
        const fileInfo = { id: fileId, name: file.name, content: null, fileType: 'other', icon: 'draft', iconColor: '#7f8c8d', typeDescription: 'Файл', previewUrl: null };
        const extension = file.name.split('.').pop().toLowerCase();
        
        if (file.type.startsWith('image/')) {
            fileInfo.fileType = 'image'; fileInfo.icon = 'image'; fileInfo.iconColor = '#8e44ad'; fileInfo.typeDescription = 'Изображение';
            fileInfo.previewUrl = URL.createObjectURL(file);
        } else if (['docx', 'doc'].includes(extension)) {
            fileInfo.icon = 'description'; fileInfo.iconColor = '#2980b9'; fileInfo.typeDescription = 'Документ';
        } else if (['py', 'js', 'html', 'css', 'cpp'].includes(extension)) {
            fileInfo.icon = 'code'; fileInfo.iconColor = '#f39c12'; fileInfo.typeDescription = 'Код';
        } else if (['txt', 'me'].includes(extension)) {
            fileInfo.icon = 'subject'; fileInfo.iconColor = '#7f8c8d'; fileInfo.typeDescription = 'Текст';
        }

        state.attachedFiles.push(fileInfo);
        renderFilePreviews();
        const iconEl = DOMElements.filePreviewContainer.querySelector(`[data-file-id="${fileId}"] .file-preview-icon`);
        iconEl.classList.add('is-loading');

        try {
            if (fileInfo.fileType === 'image') {
                // Читаем изображение как base64
                fileInfo.content = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = e => resolve(e.target.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });
                URL.revokeObjectURL(fileInfo.previewUrl); // Освобождаем память от временной ссылки
                fileInfo.previewUrl = fileInfo.content; // Используем base64 для предпросмотра
                
                const imgEl = DOMElements.filePreviewContainer.querySelector(`[data-file-id="${fileId}"] .file-preview-img`);
                if(imgEl) imgEl.src = fileInfo.previewUrl;

            } else if (['txt', 'me', 'py', 'html', 'css', 'js', 'cpp'].includes(extension)) {
                fileInfo.content = await file.text();
            } else if (['docx', 'doc'].includes(extension)) {
                const arrayBuffer = await file.arrayBuffer();
                const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
                fileInfo.content = result.value;
            } else {
                fileInfo.content = `[Неподдерживаемый тип файла: ${file.name}]`;
            }
        } catch (error) {
            console.error("Ошибка обработки файла:", error);
            fileInfo.content = `[Ошибка чтения файла: ${file.name}]`;
        } finally {
            if (iconEl) iconEl.classList.remove('is-loading');
            setSendButtonState();
        }
    }
     DOMElements.fileInput.value = '';
}

function removeAttachedFile(fileId) {
    const fileToRemove = state.attachedFiles.find(f => f.id === fileId);
    // Убрали revokeObjectURL, т.к. base64 не требует освобождения
    state.attachedFiles = state.attachedFiles.filter(f => f.id !== fileId);
    renderFilePreviews(); setSendButtonState();
}
function clearAttachedFiles() {
    state.attachedFiles = [];
    renderFilePreviews(); setSendButtonState();
}

// --- ВЗАИМОДЕЙСТВИЕ С AI, РЕДАКТИРОВАНИЕ, ОТПРАВКА ---
const getApiKeyForModel = (modelId) => MODEL_KEY_MAP[modelId] ? state.settings.apiKeys[MODEL_KEY_MAP[modelId]] : null;
function addMessageToDOM(message, isHistory = false) {
    const messageEl = document.createElement('div');
    messageEl.className = `message ${message.role}`;
    messageEl.dataset.messageId = message.id;
    const messageBody = document.createElement('div');
    messageBody.className = 'message-body';
    if (message.role === 'user') {
        const hasFiles = message.files && message.files.length > 0;
        const hasText = message.originalContent && message.originalContent.trim() !== '';
        if (!hasFiles && !hasText) return; 
        if (hasFiles) {
            message.files.forEach(file => {
                const attachmentEl = document.createElement('div');
                attachmentEl.className = 'user-message-part attachment-preview';
                const displayName = file.name.length > 25 ? file.name.substring(0, 22) + '...' : file.name;
                let iconOrImg;
                if(file.fileType === 'image' && file.previewUrl) {
                     iconOrImg = `<img src="${file.previewUrl}" alt="${file.name}" style="width: 100%; height: 100%; object-fit: cover;">`;
                } else {
                     iconOrImg = `<span class="material-symbols-outlined">${file.icon || 'description'}</span>`;
                }
                
                attachmentEl.innerHTML = `
                    <div class="attachment-icon" style="background-color: ${file.iconColor || '#007bff'};">${iconOrImg}</div>
                    <div class="attachment-details"><div class="attachment-name">${displayName}</div><div class="attachment-type">${file.typeDescription || 'Файл'}</div></div>`;
                messageBody.appendChild(attachmentEl);
            });
        }
        if (hasText) {
            const textEl = document.createElement('div');
            textEl.className = 'user-message-part text-preview';
            textEl.innerHTML = marked.parse(message.originalContent);
            messageBody.appendChild(textEl);
        }
        messageEl.appendChild(messageBody);
        if(hasText || (message.files && message.files.length > 0)){
            const actionsEl = document.createElement('div');
            actionsEl.className = 'message-actions';
            actionsEl.innerHTML = `<button class="icon-btn edit-message-btn" title="Редактировать"><span class="material-symbols-outlined">edit</span></button>`;
            messageEl.appendChild(actionsEl);
        }
    } else { // Assistant
        const contentEl = document.createElement('div');
        contentEl.className = 'message-content';
        contentEl.innerHTML = marked.parse(message.content || '...');
        messageBody.appendChild(contentEl);
        messageEl.appendChild(messageBody);
        enhanceCodeBlocks(contentEl);
        enhanceTables(contentEl);
    }
    DOMElements.chatContainer.appendChild(messageEl);
    if (!isHistory) { scrollToBottom(); }
    return messageEl;
}
function updateAIActions() {
    document.querySelectorAll('.ai-response-actions').forEach(el => el.remove());
    if (state.isGenerating || state.conversationHistory.length === 0) return;
    const lastMessage = state.conversationHistory.slice(-1)[0];
    const lastMessageEl = DOMElements.chatContainer.querySelector(`.message[data-message-id="${lastMessage.id}"]`);
    if (lastMessage.role === 'assistant' && lastMessageEl) {
        const panel = document.createElement('div');
        panel.className = 'ai-response-actions';
        panel.innerHTML = `
            <button class="icon-btn copy-btn" title="Копировать"><span class="material-symbols-outlined">content_copy</span></button>
            <button class="icon-btn like-btn" title="Нравится"><span class="material-symbols-outlined">thumb_up</span></button>
            <button class="icon-btn dislike-btn" title="Не нравится"><span class="material-symbols-outlined">thumb_down</span></button>
            <button class="icon-btn regenerate-btn" title="Регенерировать"><span class="material-symbols-outlined">refresh</span></button>
            <div class="more-btn-container">
                <button class="icon-btn more-btn" title="Ещё"><span class="material-icons">more_horiz</span></button>
                <div class="more-options-menu">
                    <div class="more-option-item" data-action="elaborate"><span class="material-symbols-outlined">expand_content</span>Сделать подробнее</div>
                    <div class="more-option-item" data-action="summarize"><span class="material-symbols-outlined">short_text</span>Сделать короче</div>
                    <div class="more-option-item" data-action="search"><span class="material-symbols-outlined">public</span>Поиск в сети</div>
                </div>
            </div>`;
        lastMessageEl.querySelector('.message-body').appendChild(panel);
    }
}
function handleRegenerateRequest() {
    if (state.isGenerating || state.conversationHistory.length < 2) return;
    const lastAiMsgIndex = state.conversationHistory.findLastIndex(m => m.role === 'assistant');
    if (lastAiMsgIndex === -1) return;
    
    const lastAiMsgEl = DOMElements.chatContainer.querySelector(`.message.assistant:last-of-type`);
    if (lastAiMsgEl) lastAiMsgEl.remove();
    
    state.conversationHistory.splice(lastAiMsgIndex);
    getAIResponse();
}
async function handleModificationRequest(type) {
    if (state.isGenerating || state.conversationHistory.length === 0) return;
    const lastAiMsg = state.conversationHistory.findLast(m => m.role === 'assistant');
    if (!lastAiMsg) return;

    DOMElements.chatContainer.querySelector('.message.assistant:last-of-type')?.remove();
    state.conversationHistory.pop();

    const modificationPrompt = type === 'elaborate' ? 'Сделай свой предыдущий ответ более подробным и развернутым.' : 'Сократи свой предыдущий ответ, сделай его более сжатым и по существу.';
    const followUpMsg = { role: 'user', content: modificationPrompt, isHidden: true, originalContent: modificationPrompt }; 
    state.conversationHistory.push(followUpMsg);
    await getAIResponse();
    
    const hiddenPromptIndex = state.conversationHistory.findIndex(m => m.isHidden);
    if (hiddenPromptIndex > -1) { state.conversationHistory.splice(hiddenPromptIndex, 1); }
    updateCurrentChat();
}

// --- EDITING FUNCTIONS (DESKTOP + MOBILE) ---

async function _saveAndForkHistory(messageId, newText) {
    const editedMsgIndex = state.conversationHistory.findIndex(m => m.id === messageId);
    if (editedMsgIndex === -1) return;

    const originalMessage = state.conversationHistory[editedMsgIndex];
    if (newText.trim() === originalMessage.originalContent.trim()) return; 

    const messageEl = DOMElements.chatContainer.querySelector(`.message[data-message-id="${messageId}"]`);
    if (messageEl) {
        while (messageEl.nextSibling) {
            messageEl.nextSibling.remove();
        }
    }
    
    state.conversationHistory = state.conversationHistory.slice(0, editedMsgIndex + 1);
    
    const messageToUpdate = state.conversationHistory[editedMsgIndex];
    messageToUpdate.originalContent = newText;
    
    if (messageEl) {
        const textPreview = messageEl.querySelector('.text-preview');
        if (textPreview) textPreview.innerHTML = marked.parse(newText);
    }
    
    await getAIResponse();
}

function enterEditModeDesktop(messageId) {
    if (state.editingMessageId) exitEditModeDesktop();

    const message = state.conversationHistory.find(m => m.id === messageId);
    const messageEl = DOMElements.chatContainer.querySelector(`.message[data-message-id="${messageId}"]`);
    if (!message || !messageEl) return;

    const textContentEl = messageEl.querySelector('.text-preview');
    const hasText = message.originalContent && message.originalContent.trim() !== '';

    if (!textContentEl && hasText) return; // Should not happen but guard it
    
    state.editingMessageId = messageId;

    if(hasText){
        activeEditorInfo.originalNode = textContentEl;
        const editorContainer = document.createElement('div');
        editorContainer.className = 'message-editor';
        const textarea = document.createElement('textarea');
        textarea.rows = '1';
        textarea.value = message.originalContent;
        
        const autoResize = () => { textarea.style.height = 'auto'; textarea.style.height = `${textarea.scrollHeight}px`; };
        textarea.addEventListener('input', autoResize);
        
        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'message-editor-actions';
        const cancelButton = document.createElement('button');
        cancelButton.className = 'message-editor-btn cancel';
        cancelButton.textContent = 'Отменить';
        cancelButton.onclick = exitEditMode;

        const saveButton = document.createElement('button');
        saveButton.className = 'message-editor-btn save';
        saveButton.textContent = 'Отправить';
        saveButton.onclick = () => saveEditedMessageDesktop();

        actionsContainer.append(cancelButton, saveButton);
        editorContainer.append(textarea, actionsContainer);
        textContentEl.replaceWith(editorContainer);
         setTimeout(autoResize, 0);
         textarea.focus();
         textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }
    
    document.body.classList.add('is-editing-message');
    messageEl.classList.add('is-being-edited');
}

function exitEditModeDesktop() {
    if (!state.editingMessageId || !document.body.classList.contains('is-editing-message')) return;
    const messageEl = DOMElements.chatContainer.querySelector(`.message[data-message-id="${state.editingMessageId}"]`);
    if (messageEl) {
        const editorEl = messageEl.querySelector('.message-editor');
        if (editorEl && activeEditorInfo.originalNode) {
            editorEl.replaceWith(activeEditorInfo.originalNode);
        }
        messageEl.classList.remove('is-being-edited');
    }
    document.body.classList.remove('is-editing-message');
    state.editingMessageId = null;
    activeEditorInfo.originalNode = null;
}

async function saveEditedMessageDesktop() {
    if (!state.editingMessageId) return;
    const messageEl = DOMElements.chatContainer.querySelector(`.message[data-message-id="${state.editingMessageId}"]`);
    const editorTextarea = messageEl.querySelector('.message-editor textarea');
    const newText = editorTextarea ? editorTextarea.value : state.conversationHistory.find(m => m.id === state.editingMessageId).originalContent;
    
    const messageIdToSave = state.editingMessageId;
    
    exitEditModeDesktop();
    await _saveAndForkHistory(messageIdToSave, newText);
}

function enterEditModeMobile(messageId) {
    const message = state.conversationHistory.find(m => m.id === messageId);
    if (!message) return;

    state.editingMessageId = messageId;
    DOMElements.editModeContainer.style.display = 'flex';
    DOMElements.footer.classList.add('is-editing');
    DOMElements.messageInput.value = message.originalContent || '';
    DOMElements.messageInput.focus();
    DOMElements.messageInput.dispatchEvent(new Event('input')); 

    DOMElements.attachFileBtn.disabled = true;
    DOMElements.micBtn.disabled = true;
    document.querySelectorAll('.edit-message-btn').forEach(btn => btn.disabled = true);
    setSendButtonState();
}

function exitEditModeMobile() {
    if (!state.editingMessageId || !DOMElements.footer.classList.contains('is-editing')) return;
    state.editingMessageId = null;
    DOMElements.editModeContainer.style.display = 'none';
    DOMElements.footer.classList.remove('is-editing');
    DOMElements.messageInput.value = '';
    DOMElements.messageInput.dispatchEvent(new Event('input')); 
    
    DOMElements.attachFileBtn.disabled = false;
    DOMElements.micBtn.disabled = false;
    document.querySelectorAll('.edit-message-btn').forEach(btn => btn.disabled = false);
    setSendButtonState();
}

async function saveEditedMessageMobile() {
    if (!state.editingMessageId) return;
    const newText = DOMElements.messageInput.value;
    const messageIdToSave = state.editingMessageId;

    exitEditModeMobile();
    await _saveAndForkHistory(messageIdToSave, newText);
}

function enterEditMode(messageId) {
    if (state.isGenerating) return;
    if (window.innerWidth < 1024) {
        enterEditModeMobile(messageId);
    } else {
        enterEditModeDesktop(messageId);
    }
}

function exitEditMode() {
    exitEditModeDesktop();
    exitEditModeMobile();
}

const stopGeneration = () => { if (state.abortController) { state.abortController.abort(); state.abortController = null; } };

async function handleSendOrStop() {
    if (state.isGenerating) {
        stopGeneration();
    } else if (state.editingMessageId && window.innerWidth < 1024) {
        await saveEditedMessageMobile();
    } else {
        await handleSendMessage();
    }
}
async function handleSendMessage() {
    const userText = DOMElements.messageInput.value.trim();
    if (userText === '' && state.attachedFiles.length === 0) return;
    const apiKey = getApiKeyForModel(state.currentModel);
    if (!apiKey) { alert(`API ключ для модели "${DOMElements.currentModelName.textContent}" не найден.`); toggleSettingsModal(true); return; }
    
    if (state.currentChatId === null) {
        const newChatObject = { id: Date.now(), title: 'Новый чат', messages: [], model: state.currentModel, createdAt: new Date().toISOString() };
        state.chats.unshift(newChatObject); state.currentChatId = newChatObject.id;
    }
    DOMElements.welcomeScreen.classList.add('hidden'); DOMElements.chatContainer.classList.add('active');
    
    const userMsg = { 
        role: 'user', id: Date.now(), originalContent: userText, 
        files: state.attachedFiles.map(f => ({...f})) // a copy of files
    };
    
    state.conversationHistory.push(userMsg);
    addMessageToDOM(userMsg);
    
    DOMElements.messageInput.value = ''; DOMElements.messageInput.dispatchEvent(new Event('input'));
    clearAttachedFiles();
    
    await getAIResponse();
}

// ИЗМЕНЕНИЕ ЗДЕСЬ: Основная логика формирования запроса к API
async function getAIResponse() {
    state.isGenerating = true; document.body.classList.add('is-generating'); setSendButtonState(); state.abortController = new AbortController();
    
    const messagesToSend = state.conversationHistory.filter(m => !m.isHidden).map(msg => {
        if (msg.role === 'assistant') {
            return { role: 'assistant', content: msg.content };
        }

        // User message processing
        const hasImages = msg.files && msg.files.some(f => f.fileType === 'image');

        if (VISION_MODELS.includes(state.currentModel) && hasImages) {
            // Vision model logic
            const textParts = [];
            if (msg.originalContent) {
                textParts.push(msg.originalContent);
            }

            const textFileContent = msg.files
                .filter(f => f.fileType !== 'image' && f.content)
                .map(f => `\n\n--- Контекст из файла ${f.name} ---\n${f.content}`)
                .join('');
            
            if (textFileContent) {
                textParts.push(textFileContent);
            }

            const contentParts = [{ type: 'text', text: textParts.join('\n') }];
            
            msg.files.forEach(file => {
                if (file.fileType === 'image') {
                    contentParts.push({
                        type: 'image_url',
                        image_url: { url: file.content } // content is the base64 data URL
                    });
                }
            });
            return { role: 'user', content: contentParts };

        } else {
            // Standard text-based model logic
            let combinedContent = msg.originalContent || '';
            if (msg.files && msg.files.length > 0) {
                const fileContext = msg.files
                    .map(f => {
                        const fileText = f.fileType === 'image' ? `[Изображение: ${f.name}]` : f.content;
                        return `\n\n--- Контекст из файла ${f.name} ---\n${fileText}`;
                    })
                    .join('');
                combinedContent += fileContext;
            }
            return { role: 'user', content: combinedContent };
        }
    });

    let finalSystemPrompt = state.settings.systemPrompt;
    if(state.settings.userName && state.settings.userName !== 'Пользователь') {
        finalSystemPrompt += `\n\nК пользователю обращайся по имени: ${state.settings.userName}.`;
    }
    if (finalSystemPrompt) { messagesToSend.unshift({ role: 'system', content: finalSystemPrompt.trim() }); }

    const aiMsg = { role: 'assistant', id: Date.now(), content: '' };
    const aiMessageElement = addMessageToDOM(aiMsg);
    const contentElement = aiMessageElement.querySelector('.message-content');

    try {
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getApiKeyForModel(state.currentModel)}`, 'HTTP-Referer': window.location.href, 'X-Title': encodeURIComponent(document.title) },
            body: JSON.stringify({ model: MODEL_NAMES[state.currentModel], messages: messagesToSend, stream: true }),
            signal: state.abortController.signal
        });
        if (!response.ok) { const errorData = await response.json(); throw new Error(errorData.error.message || `HTTP error! status: ${response.status}`); }

        const reader = response.body.getReader(); const decoder = new TextDecoder();
        while (true) {
            const { done, value } = await reader.read(); if (done) break;
            const textChunk = decoder.decode(value, { stream: true });
            const lines = textChunk.split('\n').filter(line => line.startsWith('data: '));
            for (const line of lines) {
                const jsonStr = line.substring(6); if (jsonStr.trim() === '[DONE]') break;
                try {
                    const parsed = JSON.parse(jsonStr);
                    const chunkContent = parsed.choices[0]?.delta?.content;
                    if (chunkContent) { aiMsg.content += chunkContent; contentElement.innerHTML = marked.parse(aiMsg.content + ' ▌'); scrollToBottom(); }
                } catch (e) { /* Ignore */ }
            }
        }
    } catch (error) {
        if (error.name !== 'AbortError') { console.error('Fetch error:', error); contentElement.innerHTML = `<span style="color: #c14a4a;">Ошибка: ${error.message}</span>`; } 
        else { aiMsg.content += '\n\n*(Генерация остановлена)*'; }
    } finally {
        state.isGenerating = false; document.body.classList.remove('is-generating'); state.abortController = null;
        contentElement.innerHTML = marked.parse(aiMsg.content);
        
        state.conversationHistory.push(aiMsg);

        enhanceCodeBlocks(aiMessageElement);
        enhanceTables(aiMessageElement);
        setSendButtonState(); updateCurrentChat(); updateAIActions();
        const isNewChat = state.conversationHistory.length <= 2;
        if (isNewChat && aiMsg.content) { generateChatTitle(state.currentChatId); }
    }
}

async function generateChatTitle(chatId) {
    const chat = state.chats.find(c => c.id === chatId);
    if (!chat || chat.title !== 'Новый чат') return;
    const userContent = chat.messages[0].originalContent || ''; const aiContent = chat.messages[1].content.substring(0, 150);
    const titlePrompt = `Придумай короткий заголовок (3-5 слов) для этого диалога. Ответь только заголовком. Диалог:\n\nUser: ${userContent}\nAI: ${aiContent}`;
    const apiKey = getApiKeyForModel(state.currentModel); if (!apiKey) return;
    try {
        const response = await fetch(API_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body: JSON.stringify({ model: MODEL_NAMES[state.currentModel], messages: [{ role: 'user', content: titlePrompt }], max_tokens: 20 }) });
        if (!response.ok) return; const data = await response.json(); const newTitle = data.choices[0]?.message?.content;
        if (newTitle) { const chatToRename = state.chats.find(c => c.id === chatId); if (chatToRename) { chatToRename.title = newTitle.replace(/["'«»]/g, "").trim(); saveState(); renderChatsList(); } }
    } catch (error) { console.error('Error generating title:', error); }
}

// --- НАВЕШИВАНИЕ ОБРАБОТЧИКОВ СОБЫТИЙ ---
function addEventListeners() {
    DOMElements.menuIcon.addEventListener('click', () => toggleSidebar());
    DOMElements.closeSidebar.addEventListener('click', () => toggleSidebar(false));
    DOMElements.sidebarOverlay.addEventListener('click', () => { toggleSidebar(false); toggleSettingsModal(false); });
    DOMElements.newChatBtn.addEventListener('click', createNewChat);
    DOMElements.headerNewChatBtn.addEventListener('click', createNewChat);
    DOMElements.chatSearchInput.addEventListener('input', renderChatsList);
    DOMElements.userProfileBtn.addEventListener('click', () => toggleSettingsModal(true));
    DOMElements.closeSettingsModal.addEventListener('click', () => toggleSettingsModal(false));
    DOMElements.saveSettingsBtn.addEventListener('click', saveSettings);
    
    DOMElements.openSidebarBtn.addEventListener('click', () => toggleSidebar(true));
    DOMElements.newChatCollapsedBtn.addEventListener('click', createNewChat);
    DOMElements.searchCollapsedBtn.addEventListener('click', () => {
        toggleSidebar(true);
        setTimeout(() => DOMElements.chatSearchInput.focus(), 300);
    });
    DOMElements.userProfileCollapsedBtn.addEventListener('click', () => {
        toggleSettingsModal(true);
    });
    
    DOMElements.cancelEditBtn.addEventListener('click', exitEditMode);

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (state.settings.theme === 'system') updateSystemTheme();
    });
    const settingsNav = document.querySelector('.settings-nav');
    settingsNav.addEventListener('click', e => {
        const navItem = e.target.closest('.settings-nav-item');
        if (!navItem) return;
        const page = navItem.dataset.page;
        settingsNav.querySelector('.active').classList.remove('active');
        navItem.classList.add('active');
        document.querySelector('.settings-page.active').classList.remove('active');
        document.getElementById(`settings-page-${page}`).classList.add('active');
    });
    DOMElements.modelButton.addEventListener('click', e => { e.stopPropagation(); DOMElements.modelDropdown.classList.toggle('show'); });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.model-selector')) DOMElements.modelDropdown.classList.remove('show');
        if (!e.target.closest('.more-btn-container')) { document.querySelector('.more-options-menu.show')?.classList.remove('show'); }
    });
    document.querySelectorAll('.model-option').forEach(o => { o.addEventListener('click', () => { if (!state.isGenerating) { state.currentModel = o.dataset.model; updateModelDisplay(); updateCurrentChat(); DOMElements.modelDropdown.classList.remove('show'); } }); });
    DOMElements.messageInput.addEventListener('input', () => { DOMElements.messageInput.style.height = 'auto'; DOMElements.messageInput.style.height = `${DOMElements.messageInput.scrollHeight}px`; setSendButtonState(); });
    DOMElements.messageInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendOrStop(); } });
    DOMElements.sendButton.addEventListener('click', handleSendOrStop);
    DOMElements.attachFileBtn.addEventListener('click', () => DOMElements.fileInput.click());
    DOMElements.fileInput.addEventListener('change', handleFileSelect);
    DOMElements.scrollToBottomBtn.addEventListener('click', scrollToBottom);

    DOMElements.chatContainer.addEventListener('click', e => {
        const editBtn = e.target.closest('.edit-message-btn');
        if (editBtn) {
            const messageEl = editBtn.closest('.message');
            const messageId = parseInt(messageEl.dataset.messageId);
            enterEditMode(messageId);
            return;
        }
        const lastAiMsg = state.conversationHistory.findLast(m => m.role === 'assistant');
        if (!lastAiMsg) return;
        if (e.target.closest('.copy-btn')) navigator.clipboard.writeText(lastAiMsg.content);
        if (e.target.closest('.regenerate-btn')) handleRegenerateRequest();
        const likeBtn = e.target.closest('.like-btn'); if (likeBtn) likeBtn.classList.toggle('active');
        const dislikeBtn = e.target.closest('.dislike-btn'); if (dislikeBtn) dislikeBtn.classList.toggle('active');
        const moreBtn = e.target.closest('.more-btn'); if (moreBtn) moreBtn.nextElementSibling.classList.toggle('show');
        const moreOption = e.target.closest('.more-option-item');
        if (moreOption) {
            const action = moreOption.dataset.action;
            if (action === 'elaborate' || action === 'summarize') handleModificationRequest(action);
            else if (action === 'search') window.open(`https://www.google.com/search?q=${encodeURIComponent(lastAiMsg.content.substring(0, 100))}`, '_blank');
            moreOption.parentElement.classList.remove('show');
        }
    });
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRec) {
        const rec = new SpeechRec(); rec.lang = 'ru-RU'; rec.interimResults = false;
        DOMElements.micBtn.addEventListener('click', () => { try { rec.start(); DOMElements.micBtn.style.color = '#c14a4a'; } catch (e) {} });
        rec.onresult = e => { DOMElements.messageInput.value = e.results[0][0].transcript; DOMElements.messageInput.dispatchEvent(new Event('input')); };
        rec.onend = () => DOMElements.micBtn.style.color = ''; rec.onerror = e => console.error(`Mic error: ${e.error}`);
    } else { DOMElements.micBtn.style.display = 'none'; }
}

init();