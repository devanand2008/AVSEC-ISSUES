import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:file_saver/file_saver.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import '../../core/network/avs_api_client.dart';
import '../../core/storage/encrypted_message_cache.dart';
import '../auth/auth_user.dart';

class ConversationsScreen extends StatefulWidget {
  const ConversationsScreen({
    super.key,
    required this.client,
    required this.user,
    this.cache,
    this.cacheError,
  });

  final AvsApiClient client;
  final AuthUser user;
  final EncryptedMessageCache? cache;
  final Object? cacheError;

  @override
  State<ConversationsScreen> createState() => _ConversationsScreenState();
}

class _ConversationsScreenState extends State<ConversationsScreen> {
  final _search = TextEditingController();
  List<Map<String, dynamic>> _items = const [];
  bool _loading = true;
  bool _offline = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final query = _search.text.trim();
      final raw = await widget.client.get(
        '/conversations${query.isEmpty ? '' : '?search=${Uri.encodeQueryComponent(query)}'}',
      );
      final values = (raw as List<dynamic>)
          .whereType<Map<String, dynamic>>()
          .toList();
      await widget.cache?.cacheConversations(values);
      if (mounted) {
        setState(() {
          _items = values;
          _offline = false;
        });
      }
    } catch (error) {
      final cached = await widget.cache?.conversations() ?? const [];
      if (mounted) {
        setState(() {
          _items = cached;
          _offline = cached.isNotEmpty;
          _error = cached.isEmpty
              ? 'Messages could not be loaded. Check the college network and try again.'
              : null;
        });
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _title(Map<String, dynamic> item) {
    final title = item['title']?.toString().trim();
    if (title != null && title.isNotEmpty) return title;
    final participants = (item['participants'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>();
    final other = participants
        .map((value) => value['user'])
        .whereType<Map<String, dynamic>>()
        .where((value) => value['publicId']?.toString() != widget.user.id)
        .map((value) => value['fullName']?.toString())
        .whereType<String>();
    return other.isEmpty ? 'Conversation' : other.join(', ');
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (widget.cacheError != null)
            const Card(
              child: ListTile(
                leading: Icon(Icons.warning_amber_rounded),
                title: Text('Encrypted offline cache is unavailable'),
                subtitle: Text(
                  'Messages still work online. This device will not retain offline copies.',
                ),
              ),
            ),
          if (_offline)
            const Card(
              child: ListTile(
                leading: Icon(Icons.cloud_off),
                title: Text('Offline copy'),
                subtitle: Text('Showing encrypted messages saved on this device.'),
              ),
            ),
          TextField(
            controller: _search,
            textInputAction: TextInputAction.search,
            onSubmitted: (_) => _load(),
            decoration: InputDecoration(
              labelText: 'Search conversations',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: IconButton(
                tooltip: 'Refresh',
                onPressed: _load,
                icon: const Icon(Icons.refresh),
              ),
            ),
          ),
          const SizedBox(height: 12),
          if (_loading) const LinearProgressIndicator(),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.all(24),
              child: Text(_error!, textAlign: TextAlign.center),
            ),
          for (final item in _items)
            Card(
              child: ListTile(
                leading: CircleAvatar(
                  child: Text(_title(item).characters.first.toUpperCase()),
                ),
                title: Text(_title(item)),
                subtitle: Text(
                  ((item['messages'] as List<dynamic>? ?? const [])
                              .firstOrNull as Map<String, dynamic>?)?['body']
                          ?.toString() ??
                      'No messages yet',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                trailing: (item['unreadCount'] as num? ?? 0) > 0
                    ? Badge(
                        label: Text('${item['unreadCount']}'),
                        child: const Icon(Icons.chat_bubble_outline),
                      )
                    : const Icon(Icons.chevron_right),
                onTap: () async {
                  await Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => ConversationScreen(
                        conversationId: item['id'].toString(),
                        title: _title(item),
                        client: widget.client,
                        user: widget.user,
                        cache: widget.cache,
                      ),
                    ),
                  );
                  await _load();
                },
              ),
            ),
          if (!_loading && _error == null && _items.isEmpty)
            const Padding(
              padding: EdgeInsets.all(32),
              child: Text(
                'No conversations are available for this account.',
                textAlign: TextAlign.center,
              ),
            ),
        ],
      ),
    );
  }
}

class ConversationScreen extends StatefulWidget {
  const ConversationScreen({
    super.key,
    required this.conversationId,
    required this.title,
    required this.client,
    required this.user,
    this.cache,
  });

  final String conversationId;
  final String title;
  final AvsApiClient client;
  final AuthUser user;
  final EncryptedMessageCache? cache;

  @override
  State<ConversationScreen> createState() => _ConversationScreenState();
}

class _ConversationScreenState extends State<ConversationScreen> {
  final _composer = TextEditingController();
  final _scroll = ScrollController();
  final _picker = ImagePicker();
  final List<_QueuedAttachment> _attachments = [];
  List<Map<String, dynamic>> _messages = const [];
  io.Socket? _socket;
  Timer? _draftTimer;
  bool _loading = true;
  bool _sending = false;
  bool _offline = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _restoreAndLoad();
    _connectRealtime();
    _composer.addListener(_saveDraftSoon);
  }

  @override
  void dispose() {
    _draftTimer?.cancel();
    _composer.removeListener(_saveDraftSoon);
    _composer.dispose();
    _scroll.dispose();
    _socket?.dispose();
    super.dispose();
  }

  Future<void> _restoreAndLoad() async {
    _composer.text = await widget.cache?.draft(widget.conversationId) ?? '';
    final pending =
        (await widget.cache?.pending(widget.conversationId) ?? const [])
            .firstOrNull;
    if (pending != null) {
      if (_composer.text.trim().isEmpty) {
        _composer.text = pending['body']?.toString() ?? '';
      }
      for (final raw
          in (pending['attachments'] as List<dynamic>? ?? const [])) {
        if (raw is! Map) continue;
        try {
          _attachments.add(
            _QueuedAttachment(
              name: raw['name']?.toString() ?? 'attachment',
              mimeType:
                  raw['mimeType']?.toString() ?? 'application/octet-stream',
              bytes: Uint8List.fromList(
                base64Decode(raw['bytes']?.toString() ?? ''),
              ),
            )..state = 'RESTORED',
          );
        } catch (_) {
          // A corrupt pending file is ignored; no private content is logged.
        }
      }
    }
    await _load();
    if (pending != null && mounted) {
      setState(() {
        _error =
            'A pending message was restored from this device. Review it and retry.';
      });
    }
  }

  Future<void> _connectRealtime() async {
    final token = await widget.client.accessToken();
    if (token == null || token.isEmpty) return;
    final api = Uri.parse(widget.client.baseUrl);
    final origin = '${api.scheme}://${api.authority}';
    final socket = io.io(
      '$origin/realtime',
      io.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({'token': token})
          .disableAutoConnect()
          .enableReconnection()
          .build(),
    );
    socket.onConnect((_) {
      socket.emit('conversation.join', {
        'conversationId': widget.conversationId,
      });
    });
    socket.on('message.created', (value) async {
      if (value is! Map) return;
      final message = Map<String, dynamic>.from(value);
      if (message['conversationId']?.toString() != widget.conversationId) {
        return;
      }
      await widget.cache?.cacheMessages(widget.conversationId, [message]);
      if (!mounted) return;
      setState(() {
        _messages = [
          ..._messages.where((item) => item['id'] != message['id']),
          message,
        ]..sort(_messageOrder);
      });
      _scrollToEnd();
    });
    socket.on('message.updated', (_) => _load(silent: true));
    socket.connect();
    _socket = socket;
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent && mounted) setState(() => _loading = true);
    try {
      final raw = await widget.client
          .get('/conversations/${widget.conversationId}/messages');
      final values = (raw as List<dynamic>)
          .whereType<Map<String, dynamic>>()
          .toList()
        ..sort(_messageOrder);
      await widget.cache?.cacheMessages(widget.conversationId, values);
      await widget.cache
          ?.updateCursor(widget.conversationId, values.lastOrNull?['id']?.toString());
      await widget.client
          .post('/conversations/${widget.conversationId}/read', {});
      if (mounted) {
        setState(() {
          _messages = values;
          _offline = false;
          _error = null;
        });
        _scrollToEnd();
      }
    } catch (_) {
      final cached =
          await widget.cache?.messages(widget.conversationId) ?? const [];
      if (mounted) {
        setState(() {
          _messages = cached;
          _offline = cached.isNotEmpty;
          _error = cached.isEmpty
              ? 'This conversation is unavailable. Check the network and retry.'
              : null;
        });
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  int _messageOrder(Map<String, dynamic> a, Map<String, dynamic> b) {
    return '${a['createdAt']}'.compareTo('${b['createdAt']}');
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(
          _scroll.position.maxScrollExtent,
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOut,
        );
      }
    });
  }

  void _saveDraftSoon() {
    _draftTimer?.cancel();
    _draftTimer = Timer(const Duration(milliseconds: 350), () {
      widget.cache?.saveDraft(widget.conversationId, _composer.text);
    });
  }

  Future<void> _pickFiles() async {
    final result = await FilePicker.platform.pickFiles(
      allowMultiple: true,
      withData: true,
    );
    if (result == null) return;
    for (final file in result.files.take(10 - _attachments.length)) {
      final bytes = file.bytes;
      if (bytes == null) continue;
      _attachments.add(
        _QueuedAttachment(
          name: file.name,
          bytes: bytes,
          mimeType: _mimeFor(file.name),
        ),
      );
    }
    if (mounted) setState(() {});
  }

  Future<void> _pickImage(ImageSource source) async {
    final file = await _picker.pickImage(
      source: source,
      imageQuality: 88,
      maxWidth: 2400,
    );
    if (file == null || _attachments.length >= 10) return;
    final bytes = await file.readAsBytes();
    _attachments.add(
      _QueuedAttachment(
        name: file.name,
        bytes: bytes,
        mimeType: file.mimeType ?? _mimeFor(file.name),
      ),
    );
    if (mounted) setState(() {});
  }

  Future<String> _upload(_QueuedAttachment attachment) async {
    attachment
      ..state = 'RESERVING'
      ..progress = 0
      ..cancelled = false;
    if (mounted) setState(() {});
    final metadata = {
      'conversationId': widget.conversationId,
      'fileName': attachment.name,
      'mimeType': attachment.mimeType,
      'sizeBytes': attachment.bytes.length,
      'purpose': 'MESSAGE',
    };
    final reserved = Map<String, dynamic>.from(
      await widget.client.post('/messages/attachments', metadata) as Map,
    );
    attachment
      ..uploadId = reserved['uploadId']?.toString()
      ..storageKey = reserved['storageKey']?.toString()
      ..state = 'UPLOADING';
    if (attachment.cancelled) throw const _UploadCancelled();
    await widget.client.putSignedBytes(
      url: reserved['uploadUrl'].toString(),
      bytes: attachment.bytes,
      contentType: attachment.mimeType,
      onProgress: (value) {
        attachment.progress = value;
        if (mounted) setState(() {});
      },
    );
    if (attachment.cancelled) throw const _UploadCancelled();
    attachment.state = 'VERIFYING';
    if (mounted) setState(() {});
    await widget.client.post(
      '/messages/attachments/${attachment.uploadId}/complete',
      {...metadata, 'storageKey': attachment.storageKey},
    );
    attachment
      ..state = 'READY'
      ..progress = 1;
    if (mounted) setState(() {});
    return attachment.uploadId!;
  }

  Future<void> _send() async {
    final body = _composer.text.trim();
    if (body.isEmpty && _attachments.isEmpty) return;
    setState(() {
      _sending = true;
      _error = null;
    });
    final operationId =
        'mobile-${DateTime.now().microsecondsSinceEpoch}-${widget.user.id}';
    try {
      await widget.cache?.savePending(
        id: operationId,
        conversationId: widget.conversationId,
        state: 'UPLOADING',
        payload: {
          'body': body,
          'attachments': _attachments
              .map(
                (item) => {
                  'name': item.name,
                  'mimeType': item.mimeType,
                  'bytes': base64Encode(item.bytes),
                },
              )
              .toList(),
        },
      );
      final uploadIds = <String>[];
      for (final attachment in _attachments) {
        if (attachment.state == 'READY' && attachment.uploadId != null) {
          uploadIds.add(attachment.uploadId!);
          continue;
        }
        uploadIds.add(await _upload(attachment));
      }
      final message = Map<String, dynamic>.from(
        await widget.client.post(
          '/conversations/${widget.conversationId}/messages',
          {
            if (body.isNotEmpty) 'body': body,
            if (uploadIds.isNotEmpty) 'attachmentUploadIds': uploadIds,
            'clientId': operationId,
          },
        ) as Map,
      );
      await widget.cache?.cacheMessages(widget.conversationId, [message]);
      await widget.cache?.removePendingForConversation(widget.conversationId);
      await widget.cache?.saveDraft(widget.conversationId, '');
      _composer.clear();
      _attachments.clear();
      if (mounted) {
        setState(() {
          _messages = [
            ..._messages.where((item) => item['id'] != message['id']),
            message,
          ]..sort(_messageOrder);
        });
        _scrollToEnd();
      }
    } on _UploadCancelled {
      _error = 'Attachment upload cancelled.';
    } catch (error) {
      for (final attachment in _attachments) {
        if (attachment.state != 'READY') attachment.state = 'FAILED';
      }
      await widget.cache?.savePending(
        id: operationId,
        conversationId: widget.conversationId,
        state: 'FAILED',
        payload: {
          'body': body,
          'attachments': _attachments
              .map(
                (item) => {
                  'name': item.name,
                  'mimeType': item.mimeType,
                  'bytes': base64Encode(item.bytes),
                },
              )
              .toList(),
        },
      );
      _error = error is AvsApiException
          ? error.message
          : 'The message was not sent. Retry when the network is available.';
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _openAttachment(
    Map<String, dynamic> message,
    Map<String, dynamic> attachment,
  ) async {
    try {
      final response = Map<String, dynamic>.from(
        await widget.client.get(
          '/messages/${message['id']}/attachments/${attachment['id']}/download',
        ) as Map,
      );
      final url = response['url']?.toString();
      if (url == null) throw StateError('Missing signed download URL');
      if ((attachment['mimeType']?.toString() ?? '').startsWith('image/')) {
        if (!mounted) return;
        await showDialog<void>(
          context: context,
          builder: (context) => Dialog(
            child: InteractiveViewer(
              child: Image.network(
                url,
                errorBuilder: (_, _, _) => const Padding(
                  padding: EdgeInsets.all(32),
                  child: Text('The private image preview could not be loaded.'),
                ),
              ),
            ),
          ),
        );
        return;
      }
      final download = await widget.client.getExternalBytes(url);
      await FileSaver.instance.saveFile(
        name: attachment['originalName']?.toString() ?? 'avs-attachment',
        bytes: download.bytes,
        includeExtension: false,
        mimeType: MimeType.custom,
        customMimeType:
            attachment['mimeType']?.toString() ?? 'application/octet-stream',
      );
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Attachment unavailable: $error')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title),
        actions: [
          IconButton(
            tooltip: 'Refresh messages',
            onPressed: _load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: Column(
        children: [
          if (_loading) const LinearProgressIndicator(),
          if (_offline)
            const MaterialBanner(
              content: Text('Offline: showing the encrypted device copy.'),
              actions: [SizedBox.shrink()],
            ),
          if (_error != null)
            MaterialBanner(
              content: Text(_error!),
              actions: [
                TextButton(onPressed: _send, child: const Text('RETRY')),
              ],
            ),
          Expanded(
            child: _messages.isEmpty && !_loading
                ? const Center(child: Text('Start the conversation.'))
                : ListView.builder(
                    controller: _scroll,
                    padding: const EdgeInsets.all(12),
                    itemCount: _messages.length,
                    itemBuilder: (context, index) {
                      final message = _messages[index];
                      final own = message['senderId']?.toString() == widget.user.id;
                      final sender = message['sender'] as Map<String, dynamic>?;
                      final attachments =
                          (message['attachments'] as List<dynamic>? ?? const [])
                              .whereType<Map<String, dynamic>>();
                      return Align(
                        alignment:
                            own ? Alignment.centerRight : Alignment.centerLeft,
                        child: ConstrainedBox(
                          constraints: const BoxConstraints(maxWidth: 520),
                          child: Card(
                            color: own
                                ? Theme.of(context)
                                    .colorScheme
                                    .primaryContainer
                                : null,
                            child: Padding(
                              padding: const EdgeInsets.all(12),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  if (!own)
                                    Text(
                                      sender?['fullName']?.toString() ?? 'AVS user',
                                      style: Theme.of(context)
                                          .textTheme
                                          .labelMedium,
                                    ),
                                  if ((message['body']?.toString() ?? '').isNotEmpty)
                                    SelectableText(message['body'].toString()),
                                  for (final attachment in attachments)
                                    ListTile(
                                      contentPadding: EdgeInsets.zero,
                                      dense: true,
                                      leading: Icon(
                                        (attachment['mimeType']?.toString() ?? '')
                                                .startsWith('image/')
                                            ? Icons.image_outlined
                                            : Icons.attach_file,
                                      ),
                                      title: Text(
                                        attachment['originalName']?.toString() ??
                                            'Attachment',
                                      ),
                                      subtitle: Text(
                                        _fileSize(attachment['sizeBytes']),
                                      ),
                                      onTap: () =>
                                          _openAttachment(message, attachment),
                                    ),
                                  const SizedBox(height: 4),
                                  Text(
                                    _time(message['createdAt']),
                                    style: Theme.of(context).textTheme.labelSmall,
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      );
                    },
                  ),
          ),
          if (_attachments.isNotEmpty)
            SizedBox(
              height: 92,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 8),
                children: [
                  for (final attachment in _attachments)
                    SizedBox(
                      width: 210,
                      child: Card(
                        child: ListTile(
                          dense: true,
                          title: Text(
                            attachment.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          subtitle: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(attachment.state),
                              LinearProgressIndicator(
                                value: attachment.state == 'FAILED'
                                    ? null
                                    : attachment.progress,
                              ),
                            ],
                          ),
                          trailing: IconButton(
                            tooltip: 'Cancel attachment',
                            onPressed: _sending
                                ? () => attachment.cancelled = true
                                : () => setState(
                                      () => _attachments.remove(attachment),
                                    ),
                            icon: const Icon(Icons.close),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(8, 6, 8, 10),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  PopupMenuButton<String>(
                    tooltip: 'Attach',
                    enabled: !_sending,
                    onSelected: (value) {
                      if (value == 'file') _pickFiles();
                      if (value == 'camera') _pickImage(ImageSource.camera);
                      if (value == 'gallery') _pickImage(ImageSource.gallery);
                    },
                    itemBuilder: (_) => const [
                      PopupMenuItem(value: 'file', child: Text('Files')),
                      PopupMenuItem(value: 'camera', child: Text('Camera')),
                      PopupMenuItem(value: 'gallery', child: Text('Gallery')),
                    ],
                    icon: const Icon(Icons.add_circle_outline),
                  ),
                  Expanded(
                    child: TextField(
                      controller: _composer,
                      enabled: !_sending && !_offline,
                      minLines: 1,
                      maxLines: 5,
                      maxLength: 5000,
                      decoration: const InputDecoration(
                        hintText: 'Message',
                        counterText: '',
                      ),
                    ),
                  ),
                  IconButton.filled(
                    tooltip: 'Send',
                    onPressed: _sending || _offline ? null : _send,
                    icon: _sending
                        ? const SizedBox.square(
                            dimension: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.send),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _time(dynamic value) {
    final parsed = DateTime.tryParse('$value')?.toLocal();
    if (parsed == null) return '';
    return '${parsed.hour.toString().padLeft(2, '0')}:${parsed.minute.toString().padLeft(2, '0')}';
  }

  String _fileSize(dynamic value) {
    final bytes = int.tryParse('$value') ?? 0;
    if (bytes >= 1024 * 1024) {
      return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    }
    return '${(bytes / 1024).toStringAsFixed(1)} KB';
  }

  String _mimeFor(String name) {
    final extension = name.split('.').last.toLowerCase();
    return const {
          'jpg': 'image/jpeg',
          'jpeg': 'image/jpeg',
          'png': 'image/png',
          'webp': 'image/webp',
          'gif': 'image/gif',
          'pdf': 'application/pdf',
          'doc': 'application/msword',
          'docx':
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'xls': 'application/vnd.ms-excel',
          'xlsx':
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'txt': 'text/plain',
          'mp4': 'video/mp4',
          'mp3': 'audio/mpeg',
        }[extension] ??
        'application/octet-stream';
  }
}

class _QueuedAttachment {
  _QueuedAttachment({
    required this.name,
    required this.bytes,
    required this.mimeType,
  });

  final String name;
  final Uint8List bytes;
  final String mimeType;
  String state = 'QUEUED';
  double progress = 0;
  String? uploadId;
  String? storageKey;
  bool cancelled = false;
}

class _UploadCancelled implements Exception {
  const _UploadCancelled();
}
