import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/network/avs_api_client.dart';
import '../../core/storage/encrypted_message_cache.dart';
import '../auth/auth_user.dart';
import 'avs_bot_models.dart';
import 'avs_bot_repository.dart';
import 'avs_bot_settings_screen.dart';
import 'avs_bot_widgets.dart';

class AvsBotScreen extends StatefulWidget {
  const AvsBotScreen({
    super.key,
    required this.client,
    required this.user,
    this.cache,
    this.cacheError,
    this.onOpenRoute,
  });

  final AvsApiClient client;
  final AuthUser user;
  final EncryptedMessageCache? cache;
  final Object? cacheError;
  final ValueChanged<String>? onOpenRoute;

  @override
  State<AvsBotScreen> createState() => _AvsBotScreenState();
}

class _AvsBotScreenState extends State<AvsBotScreen> {
  late final AvsBotRepository _repository;
  final _composer = TextEditingController();
  final _scrollController = ScrollController();
  List<AvsBotConversation> _conversations = [];
  List<AvsBotMessage> _messages = [];
  List<String> _questions = [];
  AvsBotConversation? _selected;
  StreamSubscription<AvsBotStreamEvent>? _stream;
  Timer? _draftTimer;
  String? _streamingMessageId;
  Object? _error;
  bool _loading = true;
  bool _offline = false;

  bool get _sending => _streamingMessageId != null;
  String get _draftKey => _selected?.id ?? 'new';

  @override
  void initState() {
    super.initState();
    _repository = AvsBotRepository(client: widget.client, cache: widget.cache);
    _load();
  }

  @override
  void dispose() {
    _stream?.cancel();
    _draftTimer?.cancel();
    _composer.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        _repository.conversations(),
        _repository.suggestedQuestions().catchError((_) => <String>[]),
      ]);
      final conversations = results[0] as List<AvsBotConversation>;
      final questions = results[1] as List<String>;
      if (!mounted) return;
      setState(() {
        _conversations = conversations;
        _questions = questions;
        _offline = _repository.lastReadWasOffline;
      });
      if (conversations.isNotEmpty) {
        await _select(conversations.first);
      } else {
        _composer.text = await _repository.draft('new');
      }
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _refreshConversations() async {
    try {
      final conversations = await _repository.conversations();
      if (!mounted) return;
      setState(() {
        _conversations = conversations;
        _offline = _repository.lastReadWasOffline;
        if (_selected != null) {
          _selected = conversations
              .where((item) => item.id == _selected!.id)
              .firstOrNull;
        }
      });
    } catch (_) {
      // The current chat remains usable if refreshing the side list fails.
    }
  }

  Future<void> _select(AvsBotConversation conversation) async {
    if (_sending) return;
    setState(() {
      _selected = conversation;
      _messages = [];
      _loading = true;
      _error = null;
    });
    try {
      final messages = await _repository.messages(conversation.id);
      final draft = await _repository.draft(conversation.id);
      if (!mounted) return;
      setState(() {
        _messages = messages;
        _offline = _repository.lastReadWasOffline;
        _composer.text = draft;
      });
      _scrollToBottom();
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _newConversation() async {
    if (_sending) return;
    setState(() {
      _selected = null;
      _messages = [];
      _error = null;
      _offline = false;
    });
    _composer.text = await _repository.draft('new');
    if (mounted && Navigator.of(context).canPop()) {
      final scaffold = Scaffold.maybeOf(context);
      if (scaffold?.isDrawerOpen ?? false) Navigator.of(context).pop();
    }
  }

  Future<void> _send([String? question, String? retryMessageId]) async {
    if (_sending) return;
    final value = (question ?? _composer.text).trim();
    if (value.isEmpty) return;
    FocusScope.of(context).unfocus();
    _draftTimer?.cancel();
    await _repository.saveDraft(_draftKey, '');
    _composer.clear();
    final stamp = DateTime.now().microsecondsSinceEpoch;
    final localUser = AvsBotMessage(
      id: 'local-user-$stamp',
      role: 'USER',
      content: value,
      status: 'COMPLETED',
      createdAt: DateTime.now().toUtc(),
    );
    final localAssistant = AvsBotMessage(
      id: 'local-assistant-$stamp',
      role: 'ASSISTANT',
      content: '',
      status: 'STREAMING',
      createdAt: DateTime.now().toUtc(),
    );
    setState(() {
      _messages = [..._messages, localUser, localAssistant];
      _streamingMessageId = localAssistant.id;
      _error = null;
      _offline = false;
    });
    _scrollToBottom();
    _stream = _repository
        .send(
          conversationId: _selected?.id,
          message: value,
          retryMessageId: retryMessageId,
        )
        .listen(
          _onStreamEvent,
          onError: (Object error) {
            if (!mounted) return;
            _markStreamFailed(error);
          },
          onDone: () {
            if (mounted && _sending) {
              _markStreamFailed(const AvsBotStreamClosedException());
            }
          },
          cancelOnError: true,
        );
  }

  void _onStreamEvent(AvsBotStreamEvent event) {
    if (!mounted) return;
    final data = event.data;
    switch (event.type) {
      case 'conversation':
        final id = data['id']?.toString();
        if (id != null) {
          setState(() {
            _selected = AvsBotConversation(
              id: id,
              title: data['title']?.toString() ?? 'New conversation',
              status: data['status']?.toString() ?? 'ACTIVE',
              updatedAt: DateTime.now().toUtc(),
            );
          });
        }
      case 'message':
        final incoming = AvsBotMessage.fromJson(data);
        setState(() {
          final localIndex = _messages.indexWhere(
            (message) =>
                message.id.startsWith(
                  incoming.isAssistant ? 'local-assistant-' : 'local-user-',
                ) &&
                message.role == incoming.role,
          );
          if (localIndex >= 0) {
            _messages[localIndex] = incoming;
          } else if (!_messages.any((message) => message.id == incoming.id)) {
            _messages.add(incoming);
          }
          if (incoming.isAssistant) _streamingMessageId = incoming.id;
        });
      case 'delta':
        final messageId = data['messageId']?.toString();
        final delta = data['delta']?.toString() ?? '';
        _updateMessage(
          messageId,
          (message) => message.copyWith(content: '${message.content}$delta'),
        );
      case 'replace':
        _updateMessage(
          data['messageId']?.toString(),
          (message) =>
              message.copyWith(content: data['content']?.toString() ?? ''),
        );
      case 'sources':
        final sources = (data['sources'] as List<dynamic>? ?? const [])
            .whereType<Map>()
            .map(
              (value) =>
                  AvsBotSource.fromJson(Map<String, dynamic>.from(value)),
            )
            .toList();
        _updateMessage(
          data['messageId']?.toString(),
          (message) => message.copyWith(sources: sources),
        );
      case 'done':
        final actions = (data['suggestedActions'] as List<dynamic>? ?? const [])
            .whereType<Map>()
            .map(
              (value) =>
                  AvsBotAction.fromJson(Map<String, dynamic>.from(value)),
            )
            .where((action) => action.isAllowed)
            .toList();
        final messageId = data['messageId']?.toString();
        _updateMessage(
          messageId,
          (message) => message.copyWith(
            content: data['content']?.toString() ?? message.content,
            status: data['status']?.toString() ?? 'COMPLETED',
            actions: actions,
          ),
        );
        setState(() => _streamingMessageId = null);
        _stream?.cancel();
        _stream = null;
        _persistAndRefresh();
      case 'error':
        _markStreamFailed(
          AvsApiException(
            503,
            data['message']?.toString() ?? 'AVS Bot request failed.',
          ),
        );
    }
    _scrollToBottom();
  }

  void _updateMessage(
    String? messageId,
    AvsBotMessage Function(AvsBotMessage) update,
  ) {
    if (messageId == null) return;
    setState(() {
      final index = _messages.indexWhere((message) => message.id == messageId);
      if (index >= 0) _messages[index] = update(_messages[index]);
    });
  }

  void _markStreamFailed(Object error) {
    setState(() {
      _error = error;
      final id = _streamingMessageId;
      final index = _messages.indexWhere((message) => message.id == id);
      if (index >= 0) {
        _messages[index] = _messages[index].copyWith(
          status: 'FAILED',
          content: _messages[index].content.isEmpty
              ? 'AVS Bot could not complete this response.'
              : _messages[index].content,
        );
      }
      _streamingMessageId = null;
    });
    _stream?.cancel();
    _stream = null;
  }

  Future<void> _persistAndRefresh() async {
    final id = _selected?.id;
    if (id != null) {
      await widget.cache?.cacheAiMessages(
        id,
        _messages
            .where((message) => !message.id.startsWith('local-'))
            .map((message) => message.toJson())
            .toList(),
      );
    }
    await _refreshConversations();
  }

  Future<void> _cancel() async {
    final id = _streamingMessageId;
    if (id == null || id.startsWith('local-')) {
      await _stream?.cancel();
      if (mounted) setState(() => _streamingMessageId = null);
      return;
    }
    try {
      await _repository.cancel(id);
      await _stream?.cancel();
      _updateMessage(id, (message) => message.copyWith(status: 'CANCELLED'));
      if (mounted) setState(() => _streamingMessageId = null);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('$error')));
      }
    }
  }

  Future<void> _feedback(AvsBotMessage message, String rating) async {
    try {
      await _repository.feedback(message.id, rating);
      _updateMessage(
        message.id,
        (current) => current.copyWith(feedback: rating),
      );
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('$error')));
      }
    }
  }

  Future<void> _report(AvsBotMessage message) async {
    final controller = TextEditingController();
    final comment = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Report AVS Bot response'),
        content: TextField(
          controller: controller,
          maxLength: 1000,
          maxLines: 4,
          decoration: const InputDecoration(
            labelText: 'What is wrong with this response?',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(controller.text),
            child: const Text('Report'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (comment == null) return;
    await _repository.feedback(message.id, 'REPORTED', comment: comment);
    _updateMessage(
      message.id,
      (current) => current.copyWith(feedback: 'REPORTED'),
    );
  }

  void _retry(AvsBotMessage assistant) {
    final index = _messages.indexWhere((message) => message.id == assistant.id);
    if (index <= 0) return;
    final user = _messages
        .sublist(0, index)
        .lastWhere((message) => !message.isAssistant);
    _send(user.content, user.id.startsWith('local-') ? null : user.id);
  }

  void _openAction(AvsBotAction action) {
    if (!action.isAllowed) return;
    Navigator.of(context).pop();
    widget.onOpenRoute?.call(action.route);
  }

  Future<void> _archiveCurrent() async {
    final selected = _selected;
    if (selected == null || _sending) return;
    await _repository.archiveConversation(selected.id);
    await _newConversation();
    await _refreshConversations();
  }

  void _saveDraft(String value) {
    _draftTimer?.cancel();
    final key = _draftKey;
    _draftTimer = Timer(
      const Duration(milliseconds: 350),
      () => _repository.saveDraft(key, value),
    );
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 220),
        curve: Curves.easeOut,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final wide = constraints.maxWidth >= 900;
        final conversationPane = _ConversationPane(
          conversations: _conversations,
          selectedId: _selected?.id,
          onSelected: _select,
          onNew: _newConversation,
        );
        return Scaffold(
          appBar: AppBar(
            title: const Text('AVS Bot'),
            actions: [
              IconButton(
                tooltip: 'Preferences',
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) =>
                        AvsBotSettingsScreen(repository: _repository),
                  ),
                ),
                icon: const Icon(Icons.tune),
              ),
              IconButton(
                tooltip: 'Archive conversation',
                onPressed: _selected == null ? null : _archiveCurrent,
                icon: const Icon(Icons.archive_outlined),
              ),
            ],
          ),
          drawer: wide
              ? null
              : Drawer(child: SafeArea(child: conversationPane)),
          body: Row(
            children: [
              if (wide) ...[
                SizedBox(width: 300, child: conversationPane),
                const VerticalDivider(width: 1),
              ],
              Expanded(child: _chatPane()),
            ],
          ),
        );
      },
    );
  }

  Widget _chatPane() {
    if (_loading && _messages.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    return Column(
      children: [
        const AvsBotPrivacyNotice(),
        if (_offline) const AvsBotOfflineBanner(),
        if (widget.cacheError != null)
          MaterialBanner(
            leading: const Icon(Icons.lock_outline),
            content: const Text(
              'Encrypted offline cache is unavailable on this device. Online chat can still work.',
            ),
            actions: const [SizedBox.shrink()],
          ),
        if (_error != null)
          MaterialBanner(
            leading: const Icon(Icons.error_outline),
            content: Text('$_error'),
            actions: [TextButton(onPressed: _load, child: const Text('Retry'))],
          ),
        Expanded(
          child: _messages.isEmpty
              ? AvsBotEmptyState(
                  key: const Key('avs-bot-empty-state'),
                  questions: _questions,
                  onQuestion: _send,
                )
              : ListView.builder(
                  controller: _scrollController,
                  padding: const EdgeInsets.symmetric(vertical: 10),
                  itemCount: _messages.length,
                  itemBuilder: (context, index) {
                    final message = _messages[index];
                    return AvsBotMessageBubble(
                      key: ValueKey(message.id),
                      message: message,
                      onFeedback: (rating) => _feedback(message, rating),
                      onReport: () => _report(message),
                      onRetry: () => _retry(message),
                      onAction: _openAction,
                    );
                  },
                ),
        ),
        AvsBotComposer(
          controller: _composer,
          sending: _sending,
          onSend: _send,
          onCancel: _cancel,
          onChanged: _saveDraft,
        ),
      ],
    );
  }
}

class _ConversationPane extends StatelessWidget {
  const _ConversationPane({
    required this.conversations,
    required this.selectedId,
    required this.onSelected,
    required this.onNew,
  });

  final List<AvsBotConversation> conversations;
  final String? selectedId;
  final ValueChanged<AvsBotConversation> onSelected;
  final VoidCallback onNew;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: FilledButton.icon(
            onPressed: onNew,
            icon: const Icon(Icons.add_comment_outlined),
            label: const Text('New conversation'),
          ),
        ),
        const Divider(height: 1),
        Expanded(
          child: conversations.isEmpty
              ? const Center(
                  child: Padding(
                    padding: EdgeInsets.all(20),
                    child: Text(
                      'Your AVS Bot conversations will appear here.',
                      textAlign: TextAlign.center,
                    ),
                  ),
                )
              : ListView.builder(
                  itemCount: conversations.length,
                  itemBuilder: (context, index) {
                    final conversation = conversations[index];
                    return ListTile(
                      selected: conversation.id == selectedId,
                      leading: const Icon(Icons.chat_bubble_outline),
                      title: Text(
                        conversation.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      subtitle: conversation.preview == null
                          ? null
                          : Text(
                              conversation.preview!,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                      onTap: () => onSelected(conversation),
                    );
                  },
                ),
        ),
      ],
    );
  }
}

class AvsBotStreamClosedException implements Exception {
  const AvsBotStreamClosedException();

  @override
  String toString() => 'The AVS Bot stream closed before completion.';
}
