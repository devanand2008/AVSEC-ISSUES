import 'dart:math';

import '../../core/network/avs_api_client.dart';
import '../../core/storage/encrypted_message_cache.dart';
import 'avs_bot_models.dart';

class AvsBotRepository {
  AvsBotRepository({required this.client, this.cache});

  final AvsApiClient client;
  final EncryptedMessageCache? cache;
  bool lastReadWasOffline = false;

  Future<List<AvsBotConversation>> conversations() async {
    try {
      final payload = await client.get('/ai/conversations');
      final rows = (payload as List<dynamic>)
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList();
      await cache?.cacheAiConversations(rows);
      lastReadWasOffline = false;
      return rows.map(AvsBotConversation.fromJson).toList();
    } catch (_) {
      final rows = await cache?.aiConversations() ?? const [];
      if (rows.isEmpty) rethrow;
      lastReadWasOffline = true;
      return rows.map(AvsBotConversation.fromJson).toList();
    }
  }

  Future<List<AvsBotMessage>> messages(String conversationId) async {
    try {
      final payload = await client.get(
        '/ai/conversations/$conversationId/messages',
      );
      final rows = (payload as List<dynamic>)
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList();
      await cache?.cacheAiMessages(conversationId, rows);
      lastReadWasOffline = false;
      return rows.map(AvsBotMessage.fromJson).toList();
    } catch (_) {
      final rows = await cache?.aiMessages(conversationId) ?? const [];
      if (rows.isEmpty) rethrow;
      lastReadWasOffline = true;
      return rows.map(AvsBotMessage.fromJson).toList();
    }
  }

  Stream<AvsBotStreamEvent> send({
    String? conversationId,
    required String message,
    String? retryMessageId,
  }) {
    final requestId =
        '${DateTime.now().microsecondsSinceEpoch}-${Random.secure().nextInt(1 << 32)}';
    return client
        .postSse('/ai/chat/stream', {
          ...(conversationId == null
              ? const <String, dynamic>{}
              : {'conversationId': conversationId}),
          'message': message,
          'clientRequestId': requestId,
          ...(retryMessageId == null
              ? const <String, dynamic>{}
              : {'retryMessageId': retryMessageId}),
        })
        .map(
          (event) => AvsBotStreamEvent(
            event.event,
            event.data is Map
                ? Map<String, dynamic>.from(event.data as Map)
                : {'value': event.data},
          ),
        );
  }

  Future<List<String>> suggestedQuestions() async {
    final payload = await client.get('/ai/suggested-questions');
    return (payload['questions'] as List<dynamic>? ?? const [])
        .map((value) => value.toString())
        .toList();
  }

  Future<void> cancel(String messageId) async {
    await client.post('/ai/messages/$messageId/cancel', {});
  }

  Future<void> feedback(
    String messageId,
    String rating, {
    String? comment,
  }) async {
    await client.post('/ai/feedback', {
      'messageId': messageId,
      'rating': rating,
      if (comment != null && comment.trim().isNotEmpty)
        'comment': comment.trim(),
    });
  }

  Future<void> archiveConversation(String conversationId) async {
    await client.patch('/ai/conversations/$conversationId', {
      'status': 'ARCHIVED',
    });
  }

  Future<Map<String, dynamic>> settings() async {
    return Map<String, dynamic>.from(await client.get('/ai/settings') as Map);
  }

  Future<Map<String, dynamic>> updateSettings(
    Map<String, dynamic> values,
  ) async {
    return Map<String, dynamic>.from(
      await client.patch('/ai/settings', values) as Map,
    );
  }

  Future<Map<String, dynamic>> adminDashboard() async {
    return Map<String, dynamic>.from(
      await client.get('/ai/admin/dashboard') as Map,
    );
  }

  Future<Map<String, dynamic>> adminSettings() async {
    return Map<String, dynamic>.from(
      await client.get('/ai/admin/settings') as Map,
    );
  }

  Future<Map<String, dynamic>> updateAdminSettings(
    Map<String, dynamic> values,
  ) async {
    return Map<String, dynamic>.from(
      await client.patch('/ai/admin/settings', values) as Map,
    );
  }

  Future<Map<String, dynamic>> testConnection() async {
    return Map<String, dynamic>.from(
      await client.post('/ai/admin/connection-test', {}) as Map,
    );
  }

  Future<List<Map<String, dynamic>>> knowledgeDocuments() async {
    final payload = await client.get('/ai/admin/knowledge');
    return (payload as List<dynamic>)
        .whereType<Map>()
        .map((value) => Map<String, dynamic>.from(value))
        .toList();
  }

  Future<Map<String, dynamic>> uploadKnowledge({
    required Map<String, String> fields,
    required String fileName,
    required List<int> bytes,
    required String contentType,
  }) async {
    return Map<String, dynamic>.from(
      await client.postFile(
            '/ai/admin/knowledge/upload',
            fields: fields,
            fileName: fileName,
            bytes: bytes,
            contentType: contentType,
          )
          as Map,
    );
  }

  Future<void> archiveKnowledge(String documentId) async {
    await client.patch('/ai/admin/knowledge/$documentId/archive', const {});
  }

  Future<void> saveDraft(String conversationId, String text) async {
    await cache?.saveAiDraft(conversationId, text);
  }

  Future<String> draft(String conversationId) async {
    return cache?.aiDraft(conversationId) ?? '';
  }
}
