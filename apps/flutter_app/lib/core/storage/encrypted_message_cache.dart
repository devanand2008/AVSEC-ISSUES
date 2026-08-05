import 'dart:convert';

import 'package:cryptography/cryptography.dart';
import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'local_database_platform.dart';

part 'encrypted_message_cache.g.dart';

class LocalConversations extends Table {
  TextColumn get id => text()();
  TextColumn get encryptedPayload => text()();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

class LocalMessages extends Table {
  TextColumn get id => text()();
  TextColumn get conversationId => text()();
  TextColumn get encryptedPayload => text()();
  TextColumn get state => text().withDefault(const Constant('SENT'))();
  DateTimeColumn get createdAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

class PendingMessageOperations extends Table {
  TextColumn get id => text()();
  TextColumn get conversationId => text()();
  TextColumn get encryptedPayload => text()();
  TextColumn get state => text()();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

class LocalDrafts extends Table {
  TextColumn get conversationId => text()();
  TextColumn get encryptedPayload => text()();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {conversationId};
}

class LocalSyncCursors extends Table {
  TextColumn get conversationId => text()();
  TextColumn get lastMessageId => text().nullable()();
  DateTimeColumn get lastSyncedAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {conversationId};
}

class LocalCachePreferences extends Table {
  IntColumn get id => integer().withDefault(const Constant(1))();
  BoolColumn get autoDownloadImages =>
      boolean().withDefault(const Constant(true))();
  BoolColumn get autoDownloadDocuments =>
      boolean().withDefault(const Constant(false))();
  BoolColumn get keepOnLogout => boolean().withDefault(const Constant(false))();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

class LocalAiConversations extends Table {
  TextColumn get id => text()();
  TextColumn get encryptedPayload => text()();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

class LocalAiMessages extends Table {
  TextColumn get id => text()();
  TextColumn get conversationId => text()();
  TextColumn get encryptedPayload => text()();
  TextColumn get state => text().withDefault(const Constant('COMPLETED'))();
  DateTimeColumn get createdAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

class LocalAiDrafts extends Table {
  TextColumn get conversationId => text()();
  TextColumn get encryptedPayload => text()();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {conversationId};
}

@DriftDatabase(
  tables: [
    LocalConversations,
    LocalMessages,
    PendingMessageOperations,
    LocalDrafts,
    LocalSyncCursors,
    LocalCachePreferences,
    LocalAiConversations,
    LocalAiMessages,
    LocalAiDrafts,
  ],
)
class AvsLocalDatabase extends _$AvsLocalDatabase {
  AvsLocalDatabase(super.connection);

  @override
  int get schemaVersion => 2;

  @override
  MigrationStrategy get migration => MigrationStrategy(
    onCreate: (migrator) => migrator.createAll(),
    onUpgrade: (migrator, from, to) async {
      if (from < 2) {
        await migrator.createTable(localAiConversations);
        await migrator.createTable(localAiMessages);
        await migrator.createTable(localAiDrafts);
      }
    },
  );
}

class EncryptedMessageCache {
  EncryptedMessageCache._(this._database, this._secretKey);

  static const _keyName = 'avs_message_cache_key_v1';
  static const _ownerName = 'avs_message_cache_owner_v1';
  static const _storage = FlutterSecureStorage();
  static final _algorithm = AesGcm.with256bits();

  final AvsLocalDatabase _database;
  final SecretKey _secretKey;

  static Future<EncryptedMessageCache> open() async {
    await configureLocalDatabasePlatform();
    var encodedKey = await _storage.read(key: _keyName);
    if (encodedKey == null) {
      final random = SecureRandom.system;
      final generated = List<int>.generate(32, (_) => random.nextInt(256));
      encodedKey = base64UrlEncode(generated);
      await _storage.write(key: _keyName, value: encodedKey);
    }
    final keyBytes = base64Url.decode(encodedKey);
    if (keyBytes.length != 32) {
      throw StateError('The local message-cache key is invalid.');
    }
    final keyHex = keyBytes
        .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
        .join();
    final database = AvsLocalDatabase(
      driftDatabase(
        name: 'avs_message_cache',
        native: encryptedNativeOptions(keyHex),
        web: DriftWebOptions(
          sqlite3Wasm: Uri.parse('sqlite3.wasm'),
          driftWorker: Uri.parse('drift_worker.js'),
        ),
      ),
    );
    await database.customSelect('SELECT 1').getSingle();
    await database
        .into(database.localCachePreferences)
        .insert(
          LocalCachePreferencesCompanion.insert(),
          mode: InsertMode.insertOrIgnore,
        );
    return EncryptedMessageCache._(database, SecretKey(keyBytes));
  }

  Future<void> cacheConversations(List<Map<String, dynamic>> values) async {
    await _database.transaction(() async {
      for (final value in values) {
        final id = value['id']?.toString();
        if (id == null) continue;
        await _database
            .into(_database.localConversations)
            .insertOnConflictUpdate(
              LocalConversationsCompanion.insert(
                id: id,
                encryptedPayload: await _encrypt(value),
                updatedAt:
                    DateTime.tryParse('${value['updatedAt']}') ??
                    DateTime.now().toUtc(),
              ),
            );
      }
    });
  }

  Future<void> cacheAiConversations(List<Map<String, dynamic>> values) async {
    await _database.transaction(() async {
      for (final value in values) {
        final id = value['id']?.toString();
        if (id == null) continue;
        await _database
            .into(_database.localAiConversations)
            .insertOnConflictUpdate(
              LocalAiConversationsCompanion.insert(
                id: id,
                encryptedPayload: await _encrypt(value),
                updatedAt:
                    DateTime.tryParse('${value['updatedAt']}') ??
                    DateTime.now().toUtc(),
              ),
            );
      }
    });
  }

  Future<List<Map<String, dynamic>>> aiConversations() async {
    final rows = await (_database.select(
      _database.localAiConversations,
    )..orderBy([(row) => OrderingTerm.desc(row.updatedAt)])).get();
    return Future.wait(rows.map((row) => _decrypt(row.encryptedPayload)));
  }

  Future<void> cacheAiMessages(
    String conversationId,
    List<Map<String, dynamic>> values,
  ) async {
    await _database.transaction(() async {
      for (final value in values) {
        final id = value['id']?.toString();
        if (id == null) continue;
        await _database
            .into(_database.localAiMessages)
            .insertOnConflictUpdate(
              LocalAiMessagesCompanion.insert(
                id: id,
                conversationId: conversationId,
                encryptedPayload: await _encrypt(value),
                state: Value(value['status']?.toString() ?? 'COMPLETED'),
                createdAt:
                    DateTime.tryParse('${value['createdAt']}') ??
                    DateTime.now().toUtc(),
              ),
            );
      }
    });
  }

  Future<List<Map<String, dynamic>>> aiMessages(String conversationId) async {
    final rows =
        await (_database.select(_database.localAiMessages)
              ..where((row) => row.conversationId.equals(conversationId))
              ..orderBy([(row) => OrderingTerm.asc(row.createdAt)]))
            .get();
    return Future.wait(rows.map((row) => _decrypt(row.encryptedPayload)));
  }

  Future<void> saveAiDraft(String conversationId, String text) async {
    if (text.trim().isEmpty) {
      await (_database.delete(
        _database.localAiDrafts,
      )..where((row) => row.conversationId.equals(conversationId))).go();
      return;
    }
    await _database
        .into(_database.localAiDrafts)
        .insertOnConflictUpdate(
          LocalAiDraftsCompanion.insert(
            conversationId: conversationId,
            encryptedPayload: await _encrypt({'text': text}),
            updatedAt: DateTime.now().toUtc(),
          ),
        );
  }

  Future<String> aiDraft(String conversationId) async {
    final row =
        await (_database.select(_database.localAiDrafts)
              ..where((value) => value.conversationId.equals(conversationId)))
            .getSingleOrNull();
    if (row == null) return '';
    return (await _decrypt(row.encryptedPayload))['text']?.toString() ?? '';
  }

  Future<void> bindAccount(String userId) async {
    final owner = await _storage.read(key: _ownerName);
    if (owner != null && owner != userId) {
      await clear();
    }
    await _storage.write(key: _ownerName, value: userId);
  }

  Future<List<Map<String, dynamic>>> conversations() async {
    final rows = await (_database.select(
      _database.localConversations,
    )..orderBy([(row) => OrderingTerm.desc(row.updatedAt)])).get();
    return Future.wait(rows.map((row) => _decrypt(row.encryptedPayload)));
  }

  Future<void> cacheMessages(
    String conversationId,
    List<Map<String, dynamic>> values,
  ) async {
    await _database.transaction(() async {
      for (final value in values) {
        final id = value['id']?.toString();
        if (id == null) continue;
        await _database
            .into(_database.localMessages)
            .insertOnConflictUpdate(
              LocalMessagesCompanion.insert(
                id: id,
                conversationId: conversationId,
                encryptedPayload: await _encrypt(value),
                state: Value(value['status']?.toString() ?? 'SENT'),
                createdAt:
                    DateTime.tryParse('${value['createdAt']}') ??
                    DateTime.now().toUtc(),
              ),
            );
      }
    });
  }

  Future<List<Map<String, dynamic>>> messages(String conversationId) async {
    final rows =
        await (_database.select(_database.localMessages)
              ..where((row) => row.conversationId.equals(conversationId))
              ..orderBy([(row) => OrderingTerm.asc(row.createdAt)]))
            .get();
    return Future.wait(rows.map((row) => _decrypt(row.encryptedPayload)));
  }

  Future<void> saveDraft(String conversationId, String text) async {
    if (text.trim().isEmpty) {
      await (_database.delete(
        _database.localDrafts,
      )..where((row) => row.conversationId.equals(conversationId))).go();
      return;
    }
    await _database
        .into(_database.localDrafts)
        .insertOnConflictUpdate(
          LocalDraftsCompanion.insert(
            conversationId: conversationId,
            encryptedPayload: await _encrypt({'text': text}),
            updatedAt: DateTime.now().toUtc(),
          ),
        );
  }

  Future<String> draft(String conversationId) async {
    final row =
        await (_database.select(_database.localDrafts)
              ..where((value) => value.conversationId.equals(conversationId)))
            .getSingleOrNull();
    if (row == null) return '';
    return (await _decrypt(row.encryptedPayload))['text']?.toString() ?? '';
  }

  Future<void> savePending({
    required String id,
    required String conversationId,
    required String state,
    required Map<String, dynamic> payload,
  }) async {
    await _database
        .into(_database.pendingMessageOperations)
        .insertOnConflictUpdate(
          PendingMessageOperationsCompanion.insert(
            id: id,
            conversationId: conversationId,
            encryptedPayload: await _encrypt(payload),
            state: state,
            updatedAt: DateTime.now().toUtc(),
          ),
        );
  }

  Future<List<Map<String, dynamic>>> pending(String conversationId) async {
    final rows =
        await (_database.select(_database.pendingMessageOperations)
              ..where((row) => row.conversationId.equals(conversationId))
              ..orderBy([(row) => OrderingTerm.desc(row.updatedAt)]))
            .get();
    return Future.wait(
      rows.map(
        (row) async => {
          'id': row.id,
          'state': row.state,
          'updatedAt': row.updatedAt.toIso8601String(),
          ...await _decrypt(row.encryptedPayload),
        },
      ),
    );
  }

  Future<void> removePending(String id) {
    return (_database.delete(
      _database.pendingMessageOperations,
    )..where((row) => row.id.equals(id))).go();
  }

  Future<void> removePendingForConversation(String conversationId) {
    return (_database.delete(
      _database.pendingMessageOperations,
    )..where((row) => row.conversationId.equals(conversationId))).go();
  }

  Future<void> updateCursor(String conversationId, String? messageId) async {
    await _database
        .into(_database.localSyncCursors)
        .insertOnConflictUpdate(
          LocalSyncCursorsCompanion.insert(
            conversationId: conversationId,
            lastMessageId: Value(messageId),
            lastSyncedAt: DateTime.now().toUtc(),
          ),
        );
  }

  Future<Map<String, dynamic>> localBackupData() async {
    final drafts = await _database.select(_database.localDrafts).get();
    final pending = await _database
        .select(_database.pendingMessageOperations)
        .get();
    return {
      'format': 'AVS_LOCAL_CACHE_V1',
      'exportedAt': DateTime.now().toUtc().toIso8601String(),
      'drafts': await Future.wait(
        drafts.map(
          (row) async => {
            'conversationId': row.conversationId,
            'payload': await _decrypt(row.encryptedPayload),
            'updatedAt': row.updatedAt.toIso8601String(),
          },
        ),
      ),
      'pending': await Future.wait(
        pending.map(
          (row) async => {
            'id': row.id,
            'conversationId': row.conversationId,
            'state': row.state,
            'payload': await _decrypt(row.encryptedPayload),
            'updatedAt': row.updatedAt.toIso8601String(),
          },
        ),
      ),
    };
  }

  Future<int> approximateSizeBytes() async {
    final row = await _database.customSelect('''
      SELECT
        COALESCE((SELECT SUM(LENGTH(encrypted_payload)) FROM local_conversations), 0) +
        COALESCE((SELECT SUM(LENGTH(encrypted_payload)) FROM local_messages), 0) +
        COALESCE((SELECT SUM(LENGTH(encrypted_payload)) FROM pending_message_operations), 0) +
        COALESCE((SELECT SUM(LENGTH(encrypted_payload)) FROM local_drafts), 0) +
        COALESCE((SELECT SUM(LENGTH(encrypted_payload)) FROM local_ai_conversations), 0) +
        COALESCE((SELECT SUM(LENGTH(encrypted_payload)) FROM local_ai_messages), 0) +
        COALESCE((SELECT SUM(LENGTH(encrypted_payload)) FROM local_ai_drafts), 0)
        AS bytes
    ''').getSingle();
    return row.read<int>('bytes');
  }

  Future<LocalCachePreference> preferences() async {
    return (_database.select(
      _database.localCachePreferences,
    )..where((row) => row.id.equals(1))).getSingle();
  }

  Future<void> setPreferences({
    required bool autoDownloadImages,
    required bool autoDownloadDocuments,
    required bool keepOnLogout,
  }) async {
    await _database
        .into(_database.localCachePreferences)
        .insertOnConflictUpdate(
          LocalCachePreferencesCompanion.insert(
            id: const Value(1),
            autoDownloadImages: Value(autoDownloadImages),
            autoDownloadDocuments: Value(autoDownloadDocuments),
            keepOnLogout: Value(keepOnLogout),
          ),
        );
  }

  Future<void> clear() async {
    await _database.transaction(() async {
      await _database.delete(_database.localMessages).go();
      await _database.delete(_database.localConversations).go();
      await _database.delete(_database.pendingMessageOperations).go();
      await _database.delete(_database.localDrafts).go();
      await _database.delete(_database.localSyncCursors).go();
      await _database.delete(_database.localAiMessages).go();
      await _database.delete(_database.localAiConversations).go();
      await _database.delete(_database.localAiDrafts).go();
    });
  }

  Future<void> close() => _database.close();

  Future<String> _encrypt(Map<String, dynamic> value) async {
    final nonce = _algorithm.newNonce();
    final box = await _algorithm.encrypt(
      utf8.encode(jsonEncode(value)),
      secretKey: _secretKey,
      nonce: nonce,
    );
    return base64UrlEncode(
      Uint8List.fromList([...nonce, ...box.mac.bytes, ...box.cipherText]),
    );
  }

  Future<Map<String, dynamic>> _decrypt(String value) async {
    final bytes = base64Url.decode(value);
    if (bytes.length < 28) {
      throw const FormatException('Encrypted cache row is invalid.');
    }
    final clear = await _algorithm.decrypt(
      SecretBox(
        bytes.sublist(28),
        nonce: bytes.sublist(0, 12),
        mac: Mac(bytes.sublist(12, 28)),
      ),
      secretKey: _secretKey,
    );
    return jsonDecode(utf8.decode(clear)) as Map<String, dynamic>;
  }
}
