// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'encrypted_message_cache.dart';

// ignore_for_file: type=lint
class $LocalConversationsTable extends LocalConversations
    with TableInfo<$LocalConversationsTable, LocalConversation> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $LocalConversationsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _encryptedPayloadMeta = const VerificationMeta(
    'encryptedPayload',
  );
  @override
  late final GeneratedColumn<String> encryptedPayload = GeneratedColumn<String>(
    'encrypted_payload',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _updatedAtMeta = const VerificationMeta(
    'updatedAt',
  );
  @override
  late final GeneratedColumn<DateTime> updatedAt = GeneratedColumn<DateTime>(
    'updated_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [id, encryptedPayload, updatedAt];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'local_conversations';
  @override
  VerificationContext validateIntegrity(
    Insertable<LocalConversation> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('encrypted_payload')) {
      context.handle(
        _encryptedPayloadMeta,
        encryptedPayload.isAcceptableOrUnknown(
          data['encrypted_payload']!,
          _encryptedPayloadMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_encryptedPayloadMeta);
    }
    if (data.containsKey('updated_at')) {
      context.handle(
        _updatedAtMeta,
        updatedAt.isAcceptableOrUnknown(data['updated_at']!, _updatedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_updatedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  LocalConversation map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return LocalConversation(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}id'],
      )!,
      encryptedPayload: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}encrypted_payload'],
      )!,
      updatedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}updated_at'],
      )!,
    );
  }

  @override
  $LocalConversationsTable createAlias(String alias) {
    return $LocalConversationsTable(attachedDatabase, alias);
  }
}

class LocalConversation extends DataClass
    implements Insertable<LocalConversation> {
  final String id;
  final String encryptedPayload;
  final DateTime updatedAt;
  const LocalConversation({
    required this.id,
    required this.encryptedPayload,
    required this.updatedAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['encrypted_payload'] = Variable<String>(encryptedPayload);
    map['updated_at'] = Variable<DateTime>(updatedAt);
    return map;
  }

  LocalConversationsCompanion toCompanion(bool nullToAbsent) {
    return LocalConversationsCompanion(
      id: Value(id),
      encryptedPayload: Value(encryptedPayload),
      updatedAt: Value(updatedAt),
    );
  }

  factory LocalConversation.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return LocalConversation(
      id: serializer.fromJson<String>(json['id']),
      encryptedPayload: serializer.fromJson<String>(json['encryptedPayload']),
      updatedAt: serializer.fromJson<DateTime>(json['updatedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'encryptedPayload': serializer.toJson<String>(encryptedPayload),
      'updatedAt': serializer.toJson<DateTime>(updatedAt),
    };
  }

  LocalConversation copyWith({
    String? id,
    String? encryptedPayload,
    DateTime? updatedAt,
  }) => LocalConversation(
    id: id ?? this.id,
    encryptedPayload: encryptedPayload ?? this.encryptedPayload,
    updatedAt: updatedAt ?? this.updatedAt,
  );
  LocalConversation copyWithCompanion(LocalConversationsCompanion data) {
    return LocalConversation(
      id: data.id.present ? data.id.value : this.id,
      encryptedPayload: data.encryptedPayload.present
          ? data.encryptedPayload.value
          : this.encryptedPayload,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('LocalConversation(')
          ..write('id: $id, ')
          ..write('encryptedPayload: $encryptedPayload, ')
          ..write('updatedAt: $updatedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, encryptedPayload, updatedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is LocalConversation &&
          other.id == this.id &&
          other.encryptedPayload == this.encryptedPayload &&
          other.updatedAt == this.updatedAt);
}

class LocalConversationsCompanion extends UpdateCompanion<LocalConversation> {
  final Value<String> id;
  final Value<String> encryptedPayload;
  final Value<DateTime> updatedAt;
  final Value<int> rowid;
  const LocalConversationsCompanion({
    this.id = const Value.absent(),
    this.encryptedPayload = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  LocalConversationsCompanion.insert({
    required String id,
    required String encryptedPayload,
    required DateTime updatedAt,
    this.rowid = const Value.absent(),
  }) : id = Value(id),
       encryptedPayload = Value(encryptedPayload),
       updatedAt = Value(updatedAt);
  static Insertable<LocalConversation> custom({
    Expression<String>? id,
    Expression<String>? encryptedPayload,
    Expression<DateTime>? updatedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (encryptedPayload != null) 'encrypted_payload': encryptedPayload,
      if (updatedAt != null) 'updated_at': updatedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  LocalConversationsCompanion copyWith({
    Value<String>? id,
    Value<String>? encryptedPayload,
    Value<DateTime>? updatedAt,
    Value<int>? rowid,
  }) {
    return LocalConversationsCompanion(
      id: id ?? this.id,
      encryptedPayload: encryptedPayload ?? this.encryptedPayload,
      updatedAt: updatedAt ?? this.updatedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (encryptedPayload.present) {
      map['encrypted_payload'] = Variable<String>(encryptedPayload.value);
    }
    if (updatedAt.present) {
      map['updated_at'] = Variable<DateTime>(updatedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('LocalConversationsCompanion(')
          ..write('id: $id, ')
          ..write('encryptedPayload: $encryptedPayload, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $LocalMessagesTable extends LocalMessages
    with TableInfo<$LocalMessagesTable, LocalMessage> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $LocalMessagesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _conversationIdMeta = const VerificationMeta(
    'conversationId',
  );
  @override
  late final GeneratedColumn<String> conversationId = GeneratedColumn<String>(
    'conversation_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _encryptedPayloadMeta = const VerificationMeta(
    'encryptedPayload',
  );
  @override
  late final GeneratedColumn<String> encryptedPayload = GeneratedColumn<String>(
    'encrypted_payload',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _stateMeta = const VerificationMeta('state');
  @override
  late final GeneratedColumn<String> state = GeneratedColumn<String>(
    'state',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant('SENT'),
  );
  static const VerificationMeta _createdAtMeta = const VerificationMeta(
    'createdAt',
  );
  @override
  late final GeneratedColumn<DateTime> createdAt = GeneratedColumn<DateTime>(
    'created_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    conversationId,
    encryptedPayload,
    state,
    createdAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'local_messages';
  @override
  VerificationContext validateIntegrity(
    Insertable<LocalMessage> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('conversation_id')) {
      context.handle(
        _conversationIdMeta,
        conversationId.isAcceptableOrUnknown(
          data['conversation_id']!,
          _conversationIdMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_conversationIdMeta);
    }
    if (data.containsKey('encrypted_payload')) {
      context.handle(
        _encryptedPayloadMeta,
        encryptedPayload.isAcceptableOrUnknown(
          data['encrypted_payload']!,
          _encryptedPayloadMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_encryptedPayloadMeta);
    }
    if (data.containsKey('state')) {
      context.handle(
        _stateMeta,
        state.isAcceptableOrUnknown(data['state']!, _stateMeta),
      );
    }
    if (data.containsKey('created_at')) {
      context.handle(
        _createdAtMeta,
        createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta),
      );
    } else if (isInserting) {
      context.missing(_createdAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  LocalMessage map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return LocalMessage(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}id'],
      )!,
      conversationId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}conversation_id'],
      )!,
      encryptedPayload: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}encrypted_payload'],
      )!,
      state: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}state'],
      )!,
      createdAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}created_at'],
      )!,
    );
  }

  @override
  $LocalMessagesTable createAlias(String alias) {
    return $LocalMessagesTable(attachedDatabase, alias);
  }
}

class LocalMessage extends DataClass implements Insertable<LocalMessage> {
  final String id;
  final String conversationId;
  final String encryptedPayload;
  final String state;
  final DateTime createdAt;
  const LocalMessage({
    required this.id,
    required this.conversationId,
    required this.encryptedPayload,
    required this.state,
    required this.createdAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['conversation_id'] = Variable<String>(conversationId);
    map['encrypted_payload'] = Variable<String>(encryptedPayload);
    map['state'] = Variable<String>(state);
    map['created_at'] = Variable<DateTime>(createdAt);
    return map;
  }

  LocalMessagesCompanion toCompanion(bool nullToAbsent) {
    return LocalMessagesCompanion(
      id: Value(id),
      conversationId: Value(conversationId),
      encryptedPayload: Value(encryptedPayload),
      state: Value(state),
      createdAt: Value(createdAt),
    );
  }

  factory LocalMessage.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return LocalMessage(
      id: serializer.fromJson<String>(json['id']),
      conversationId: serializer.fromJson<String>(json['conversationId']),
      encryptedPayload: serializer.fromJson<String>(json['encryptedPayload']),
      state: serializer.fromJson<String>(json['state']),
      createdAt: serializer.fromJson<DateTime>(json['createdAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'conversationId': serializer.toJson<String>(conversationId),
      'encryptedPayload': serializer.toJson<String>(encryptedPayload),
      'state': serializer.toJson<String>(state),
      'createdAt': serializer.toJson<DateTime>(createdAt),
    };
  }

  LocalMessage copyWith({
    String? id,
    String? conversationId,
    String? encryptedPayload,
    String? state,
    DateTime? createdAt,
  }) => LocalMessage(
    id: id ?? this.id,
    conversationId: conversationId ?? this.conversationId,
    encryptedPayload: encryptedPayload ?? this.encryptedPayload,
    state: state ?? this.state,
    createdAt: createdAt ?? this.createdAt,
  );
  LocalMessage copyWithCompanion(LocalMessagesCompanion data) {
    return LocalMessage(
      id: data.id.present ? data.id.value : this.id,
      conversationId: data.conversationId.present
          ? data.conversationId.value
          : this.conversationId,
      encryptedPayload: data.encryptedPayload.present
          ? data.encryptedPayload.value
          : this.encryptedPayload,
      state: data.state.present ? data.state.value : this.state,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('LocalMessage(')
          ..write('id: $id, ')
          ..write('conversationId: $conversationId, ')
          ..write('encryptedPayload: $encryptedPayload, ')
          ..write('state: $state, ')
          ..write('createdAt: $createdAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode =>
      Object.hash(id, conversationId, encryptedPayload, state, createdAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is LocalMessage &&
          other.id == this.id &&
          other.conversationId == this.conversationId &&
          other.encryptedPayload == this.encryptedPayload &&
          other.state == this.state &&
          other.createdAt == this.createdAt);
}

class LocalMessagesCompanion extends UpdateCompanion<LocalMessage> {
  final Value<String> id;
  final Value<String> conversationId;
  final Value<String> encryptedPayload;
  final Value<String> state;
  final Value<DateTime> createdAt;
  final Value<int> rowid;
  const LocalMessagesCompanion({
    this.id = const Value.absent(),
    this.conversationId = const Value.absent(),
    this.encryptedPayload = const Value.absent(),
    this.state = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  LocalMessagesCompanion.insert({
    required String id,
    required String conversationId,
    required String encryptedPayload,
    this.state = const Value.absent(),
    required DateTime createdAt,
    this.rowid = const Value.absent(),
  }) : id = Value(id),
       conversationId = Value(conversationId),
       encryptedPayload = Value(encryptedPayload),
       createdAt = Value(createdAt);
  static Insertable<LocalMessage> custom({
    Expression<String>? id,
    Expression<String>? conversationId,
    Expression<String>? encryptedPayload,
    Expression<String>? state,
    Expression<DateTime>? createdAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (conversationId != null) 'conversation_id': conversationId,
      if (encryptedPayload != null) 'encrypted_payload': encryptedPayload,
      if (state != null) 'state': state,
      if (createdAt != null) 'created_at': createdAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  LocalMessagesCompanion copyWith({
    Value<String>? id,
    Value<String>? conversationId,
    Value<String>? encryptedPayload,
    Value<String>? state,
    Value<DateTime>? createdAt,
    Value<int>? rowid,
  }) {
    return LocalMessagesCompanion(
      id: id ?? this.id,
      conversationId: conversationId ?? this.conversationId,
      encryptedPayload: encryptedPayload ?? this.encryptedPayload,
      state: state ?? this.state,
      createdAt: createdAt ?? this.createdAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (conversationId.present) {
      map['conversation_id'] = Variable<String>(conversationId.value);
    }
    if (encryptedPayload.present) {
      map['encrypted_payload'] = Variable<String>(encryptedPayload.value);
    }
    if (state.present) {
      map['state'] = Variable<String>(state.value);
    }
    if (createdAt.present) {
      map['created_at'] = Variable<DateTime>(createdAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('LocalMessagesCompanion(')
          ..write('id: $id, ')
          ..write('conversationId: $conversationId, ')
          ..write('encryptedPayload: $encryptedPayload, ')
          ..write('state: $state, ')
          ..write('createdAt: $createdAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $PendingMessageOperationsTable extends PendingMessageOperations
    with TableInfo<$PendingMessageOperationsTable, PendingMessageOperation> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $PendingMessageOperationsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _conversationIdMeta = const VerificationMeta(
    'conversationId',
  );
  @override
  late final GeneratedColumn<String> conversationId = GeneratedColumn<String>(
    'conversation_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _encryptedPayloadMeta = const VerificationMeta(
    'encryptedPayload',
  );
  @override
  late final GeneratedColumn<String> encryptedPayload = GeneratedColumn<String>(
    'encrypted_payload',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _stateMeta = const VerificationMeta('state');
  @override
  late final GeneratedColumn<String> state = GeneratedColumn<String>(
    'state',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _updatedAtMeta = const VerificationMeta(
    'updatedAt',
  );
  @override
  late final GeneratedColumn<DateTime> updatedAt = GeneratedColumn<DateTime>(
    'updated_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    conversationId,
    encryptedPayload,
    state,
    updatedAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'pending_message_operations';
  @override
  VerificationContext validateIntegrity(
    Insertable<PendingMessageOperation> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('conversation_id')) {
      context.handle(
        _conversationIdMeta,
        conversationId.isAcceptableOrUnknown(
          data['conversation_id']!,
          _conversationIdMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_conversationIdMeta);
    }
    if (data.containsKey('encrypted_payload')) {
      context.handle(
        _encryptedPayloadMeta,
        encryptedPayload.isAcceptableOrUnknown(
          data['encrypted_payload']!,
          _encryptedPayloadMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_encryptedPayloadMeta);
    }
    if (data.containsKey('state')) {
      context.handle(
        _stateMeta,
        state.isAcceptableOrUnknown(data['state']!, _stateMeta),
      );
    } else if (isInserting) {
      context.missing(_stateMeta);
    }
    if (data.containsKey('updated_at')) {
      context.handle(
        _updatedAtMeta,
        updatedAt.isAcceptableOrUnknown(data['updated_at']!, _updatedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_updatedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  PendingMessageOperation map(
    Map<String, dynamic> data, {
    String? tablePrefix,
  }) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return PendingMessageOperation(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}id'],
      )!,
      conversationId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}conversation_id'],
      )!,
      encryptedPayload: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}encrypted_payload'],
      )!,
      state: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}state'],
      )!,
      updatedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}updated_at'],
      )!,
    );
  }

  @override
  $PendingMessageOperationsTable createAlias(String alias) {
    return $PendingMessageOperationsTable(attachedDatabase, alias);
  }
}

class PendingMessageOperation extends DataClass
    implements Insertable<PendingMessageOperation> {
  final String id;
  final String conversationId;
  final String encryptedPayload;
  final String state;
  final DateTime updatedAt;
  const PendingMessageOperation({
    required this.id,
    required this.conversationId,
    required this.encryptedPayload,
    required this.state,
    required this.updatedAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['conversation_id'] = Variable<String>(conversationId);
    map['encrypted_payload'] = Variable<String>(encryptedPayload);
    map['state'] = Variable<String>(state);
    map['updated_at'] = Variable<DateTime>(updatedAt);
    return map;
  }

  PendingMessageOperationsCompanion toCompanion(bool nullToAbsent) {
    return PendingMessageOperationsCompanion(
      id: Value(id),
      conversationId: Value(conversationId),
      encryptedPayload: Value(encryptedPayload),
      state: Value(state),
      updatedAt: Value(updatedAt),
    );
  }

  factory PendingMessageOperation.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return PendingMessageOperation(
      id: serializer.fromJson<String>(json['id']),
      conversationId: serializer.fromJson<String>(json['conversationId']),
      encryptedPayload: serializer.fromJson<String>(json['encryptedPayload']),
      state: serializer.fromJson<String>(json['state']),
      updatedAt: serializer.fromJson<DateTime>(json['updatedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'conversationId': serializer.toJson<String>(conversationId),
      'encryptedPayload': serializer.toJson<String>(encryptedPayload),
      'state': serializer.toJson<String>(state),
      'updatedAt': serializer.toJson<DateTime>(updatedAt),
    };
  }

  PendingMessageOperation copyWith({
    String? id,
    String? conversationId,
    String? encryptedPayload,
    String? state,
    DateTime? updatedAt,
  }) => PendingMessageOperation(
    id: id ?? this.id,
    conversationId: conversationId ?? this.conversationId,
    encryptedPayload: encryptedPayload ?? this.encryptedPayload,
    state: state ?? this.state,
    updatedAt: updatedAt ?? this.updatedAt,
  );
  PendingMessageOperation copyWithCompanion(
    PendingMessageOperationsCompanion data,
  ) {
    return PendingMessageOperation(
      id: data.id.present ? data.id.value : this.id,
      conversationId: data.conversationId.present
          ? data.conversationId.value
          : this.conversationId,
      encryptedPayload: data.encryptedPayload.present
          ? data.encryptedPayload.value
          : this.encryptedPayload,
      state: data.state.present ? data.state.value : this.state,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('PendingMessageOperation(')
          ..write('id: $id, ')
          ..write('conversationId: $conversationId, ')
          ..write('encryptedPayload: $encryptedPayload, ')
          ..write('state: $state, ')
          ..write('updatedAt: $updatedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode =>
      Object.hash(id, conversationId, encryptedPayload, state, updatedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is PendingMessageOperation &&
          other.id == this.id &&
          other.conversationId == this.conversationId &&
          other.encryptedPayload == this.encryptedPayload &&
          other.state == this.state &&
          other.updatedAt == this.updatedAt);
}

class PendingMessageOperationsCompanion
    extends UpdateCompanion<PendingMessageOperation> {
  final Value<String> id;
  final Value<String> conversationId;
  final Value<String> encryptedPayload;
  final Value<String> state;
  final Value<DateTime> updatedAt;
  final Value<int> rowid;
  const PendingMessageOperationsCompanion({
    this.id = const Value.absent(),
    this.conversationId = const Value.absent(),
    this.encryptedPayload = const Value.absent(),
    this.state = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  PendingMessageOperationsCompanion.insert({
    required String id,
    required String conversationId,
    required String encryptedPayload,
    required String state,
    required DateTime updatedAt,
    this.rowid = const Value.absent(),
  }) : id = Value(id),
       conversationId = Value(conversationId),
       encryptedPayload = Value(encryptedPayload),
       state = Value(state),
       updatedAt = Value(updatedAt);
  static Insertable<PendingMessageOperation> custom({
    Expression<String>? id,
    Expression<String>? conversationId,
    Expression<String>? encryptedPayload,
    Expression<String>? state,
    Expression<DateTime>? updatedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (conversationId != null) 'conversation_id': conversationId,
      if (encryptedPayload != null) 'encrypted_payload': encryptedPayload,
      if (state != null) 'state': state,
      if (updatedAt != null) 'updated_at': updatedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  PendingMessageOperationsCompanion copyWith({
    Value<String>? id,
    Value<String>? conversationId,
    Value<String>? encryptedPayload,
    Value<String>? state,
    Value<DateTime>? updatedAt,
    Value<int>? rowid,
  }) {
    return PendingMessageOperationsCompanion(
      id: id ?? this.id,
      conversationId: conversationId ?? this.conversationId,
      encryptedPayload: encryptedPayload ?? this.encryptedPayload,
      state: state ?? this.state,
      updatedAt: updatedAt ?? this.updatedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (conversationId.present) {
      map['conversation_id'] = Variable<String>(conversationId.value);
    }
    if (encryptedPayload.present) {
      map['encrypted_payload'] = Variable<String>(encryptedPayload.value);
    }
    if (state.present) {
      map['state'] = Variable<String>(state.value);
    }
    if (updatedAt.present) {
      map['updated_at'] = Variable<DateTime>(updatedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('PendingMessageOperationsCompanion(')
          ..write('id: $id, ')
          ..write('conversationId: $conversationId, ')
          ..write('encryptedPayload: $encryptedPayload, ')
          ..write('state: $state, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $LocalDraftsTable extends LocalDrafts
    with TableInfo<$LocalDraftsTable, LocalDraft> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $LocalDraftsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _conversationIdMeta = const VerificationMeta(
    'conversationId',
  );
  @override
  late final GeneratedColumn<String> conversationId = GeneratedColumn<String>(
    'conversation_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _encryptedPayloadMeta = const VerificationMeta(
    'encryptedPayload',
  );
  @override
  late final GeneratedColumn<String> encryptedPayload = GeneratedColumn<String>(
    'encrypted_payload',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _updatedAtMeta = const VerificationMeta(
    'updatedAt',
  );
  @override
  late final GeneratedColumn<DateTime> updatedAt = GeneratedColumn<DateTime>(
    'updated_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    conversationId,
    encryptedPayload,
    updatedAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'local_drafts';
  @override
  VerificationContext validateIntegrity(
    Insertable<LocalDraft> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('conversation_id')) {
      context.handle(
        _conversationIdMeta,
        conversationId.isAcceptableOrUnknown(
          data['conversation_id']!,
          _conversationIdMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_conversationIdMeta);
    }
    if (data.containsKey('encrypted_payload')) {
      context.handle(
        _encryptedPayloadMeta,
        encryptedPayload.isAcceptableOrUnknown(
          data['encrypted_payload']!,
          _encryptedPayloadMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_encryptedPayloadMeta);
    }
    if (data.containsKey('updated_at')) {
      context.handle(
        _updatedAtMeta,
        updatedAt.isAcceptableOrUnknown(data['updated_at']!, _updatedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_updatedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {conversationId};
  @override
  LocalDraft map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return LocalDraft(
      conversationId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}conversation_id'],
      )!,
      encryptedPayload: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}encrypted_payload'],
      )!,
      updatedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}updated_at'],
      )!,
    );
  }

  @override
  $LocalDraftsTable createAlias(String alias) {
    return $LocalDraftsTable(attachedDatabase, alias);
  }
}

class LocalDraft extends DataClass implements Insertable<LocalDraft> {
  final String conversationId;
  final String encryptedPayload;
  final DateTime updatedAt;
  const LocalDraft({
    required this.conversationId,
    required this.encryptedPayload,
    required this.updatedAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['conversation_id'] = Variable<String>(conversationId);
    map['encrypted_payload'] = Variable<String>(encryptedPayload);
    map['updated_at'] = Variable<DateTime>(updatedAt);
    return map;
  }

  LocalDraftsCompanion toCompanion(bool nullToAbsent) {
    return LocalDraftsCompanion(
      conversationId: Value(conversationId),
      encryptedPayload: Value(encryptedPayload),
      updatedAt: Value(updatedAt),
    );
  }

  factory LocalDraft.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return LocalDraft(
      conversationId: serializer.fromJson<String>(json['conversationId']),
      encryptedPayload: serializer.fromJson<String>(json['encryptedPayload']),
      updatedAt: serializer.fromJson<DateTime>(json['updatedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'conversationId': serializer.toJson<String>(conversationId),
      'encryptedPayload': serializer.toJson<String>(encryptedPayload),
      'updatedAt': serializer.toJson<DateTime>(updatedAt),
    };
  }

  LocalDraft copyWith({
    String? conversationId,
    String? encryptedPayload,
    DateTime? updatedAt,
  }) => LocalDraft(
    conversationId: conversationId ?? this.conversationId,
    encryptedPayload: encryptedPayload ?? this.encryptedPayload,
    updatedAt: updatedAt ?? this.updatedAt,
  );
  LocalDraft copyWithCompanion(LocalDraftsCompanion data) {
    return LocalDraft(
      conversationId: data.conversationId.present
          ? data.conversationId.value
          : this.conversationId,
      encryptedPayload: data.encryptedPayload.present
          ? data.encryptedPayload.value
          : this.encryptedPayload,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('LocalDraft(')
          ..write('conversationId: $conversationId, ')
          ..write('encryptedPayload: $encryptedPayload, ')
          ..write('updatedAt: $updatedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(conversationId, encryptedPayload, updatedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is LocalDraft &&
          other.conversationId == this.conversationId &&
          other.encryptedPayload == this.encryptedPayload &&
          other.updatedAt == this.updatedAt);
}

class LocalDraftsCompanion extends UpdateCompanion<LocalDraft> {
  final Value<String> conversationId;
  final Value<String> encryptedPayload;
  final Value<DateTime> updatedAt;
  final Value<int> rowid;
  const LocalDraftsCompanion({
    this.conversationId = const Value.absent(),
    this.encryptedPayload = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  LocalDraftsCompanion.insert({
    required String conversationId,
    required String encryptedPayload,
    required DateTime updatedAt,
    this.rowid = const Value.absent(),
  }) : conversationId = Value(conversationId),
       encryptedPayload = Value(encryptedPayload),
       updatedAt = Value(updatedAt);
  static Insertable<LocalDraft> custom({
    Expression<String>? conversationId,
    Expression<String>? encryptedPayload,
    Expression<DateTime>? updatedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (conversationId != null) 'conversation_id': conversationId,
      if (encryptedPayload != null) 'encrypted_payload': encryptedPayload,
      if (updatedAt != null) 'updated_at': updatedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  LocalDraftsCompanion copyWith({
    Value<String>? conversationId,
    Value<String>? encryptedPayload,
    Value<DateTime>? updatedAt,
    Value<int>? rowid,
  }) {
    return LocalDraftsCompanion(
      conversationId: conversationId ?? this.conversationId,
      encryptedPayload: encryptedPayload ?? this.encryptedPayload,
      updatedAt: updatedAt ?? this.updatedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (conversationId.present) {
      map['conversation_id'] = Variable<String>(conversationId.value);
    }
    if (encryptedPayload.present) {
      map['encrypted_payload'] = Variable<String>(encryptedPayload.value);
    }
    if (updatedAt.present) {
      map['updated_at'] = Variable<DateTime>(updatedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('LocalDraftsCompanion(')
          ..write('conversationId: $conversationId, ')
          ..write('encryptedPayload: $encryptedPayload, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $LocalSyncCursorsTable extends LocalSyncCursors
    with TableInfo<$LocalSyncCursorsTable, LocalSyncCursor> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $LocalSyncCursorsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _conversationIdMeta = const VerificationMeta(
    'conversationId',
  );
  @override
  late final GeneratedColumn<String> conversationId = GeneratedColumn<String>(
    'conversation_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _lastMessageIdMeta = const VerificationMeta(
    'lastMessageId',
  );
  @override
  late final GeneratedColumn<String> lastMessageId = GeneratedColumn<String>(
    'last_message_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _lastSyncedAtMeta = const VerificationMeta(
    'lastSyncedAt',
  );
  @override
  late final GeneratedColumn<DateTime> lastSyncedAt = GeneratedColumn<DateTime>(
    'last_synced_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    conversationId,
    lastMessageId,
    lastSyncedAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'local_sync_cursors';
  @override
  VerificationContext validateIntegrity(
    Insertable<LocalSyncCursor> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('conversation_id')) {
      context.handle(
        _conversationIdMeta,
        conversationId.isAcceptableOrUnknown(
          data['conversation_id']!,
          _conversationIdMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_conversationIdMeta);
    }
    if (data.containsKey('last_message_id')) {
      context.handle(
        _lastMessageIdMeta,
        lastMessageId.isAcceptableOrUnknown(
          data['last_message_id']!,
          _lastMessageIdMeta,
        ),
      );
    }
    if (data.containsKey('last_synced_at')) {
      context.handle(
        _lastSyncedAtMeta,
        lastSyncedAt.isAcceptableOrUnknown(
          data['last_synced_at']!,
          _lastSyncedAtMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_lastSyncedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {conversationId};
  @override
  LocalSyncCursor map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return LocalSyncCursor(
      conversationId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}conversation_id'],
      )!,
      lastMessageId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}last_message_id'],
      ),
      lastSyncedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}last_synced_at'],
      )!,
    );
  }

  @override
  $LocalSyncCursorsTable createAlias(String alias) {
    return $LocalSyncCursorsTable(attachedDatabase, alias);
  }
}

class LocalSyncCursor extends DataClass implements Insertable<LocalSyncCursor> {
  final String conversationId;
  final String? lastMessageId;
  final DateTime lastSyncedAt;
  const LocalSyncCursor({
    required this.conversationId,
    this.lastMessageId,
    required this.lastSyncedAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['conversation_id'] = Variable<String>(conversationId);
    if (!nullToAbsent || lastMessageId != null) {
      map['last_message_id'] = Variable<String>(lastMessageId);
    }
    map['last_synced_at'] = Variable<DateTime>(lastSyncedAt);
    return map;
  }

  LocalSyncCursorsCompanion toCompanion(bool nullToAbsent) {
    return LocalSyncCursorsCompanion(
      conversationId: Value(conversationId),
      lastMessageId: lastMessageId == null && nullToAbsent
          ? const Value.absent()
          : Value(lastMessageId),
      lastSyncedAt: Value(lastSyncedAt),
    );
  }

  factory LocalSyncCursor.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return LocalSyncCursor(
      conversationId: serializer.fromJson<String>(json['conversationId']),
      lastMessageId: serializer.fromJson<String?>(json['lastMessageId']),
      lastSyncedAt: serializer.fromJson<DateTime>(json['lastSyncedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'conversationId': serializer.toJson<String>(conversationId),
      'lastMessageId': serializer.toJson<String?>(lastMessageId),
      'lastSyncedAt': serializer.toJson<DateTime>(lastSyncedAt),
    };
  }

  LocalSyncCursor copyWith({
    String? conversationId,
    Value<String?> lastMessageId = const Value.absent(),
    DateTime? lastSyncedAt,
  }) => LocalSyncCursor(
    conversationId: conversationId ?? this.conversationId,
    lastMessageId: lastMessageId.present
        ? lastMessageId.value
        : this.lastMessageId,
    lastSyncedAt: lastSyncedAt ?? this.lastSyncedAt,
  );
  LocalSyncCursor copyWithCompanion(LocalSyncCursorsCompanion data) {
    return LocalSyncCursor(
      conversationId: data.conversationId.present
          ? data.conversationId.value
          : this.conversationId,
      lastMessageId: data.lastMessageId.present
          ? data.lastMessageId.value
          : this.lastMessageId,
      lastSyncedAt: data.lastSyncedAt.present
          ? data.lastSyncedAt.value
          : this.lastSyncedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('LocalSyncCursor(')
          ..write('conversationId: $conversationId, ')
          ..write('lastMessageId: $lastMessageId, ')
          ..write('lastSyncedAt: $lastSyncedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(conversationId, lastMessageId, lastSyncedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is LocalSyncCursor &&
          other.conversationId == this.conversationId &&
          other.lastMessageId == this.lastMessageId &&
          other.lastSyncedAt == this.lastSyncedAt);
}

class LocalSyncCursorsCompanion extends UpdateCompanion<LocalSyncCursor> {
  final Value<String> conversationId;
  final Value<String?> lastMessageId;
  final Value<DateTime> lastSyncedAt;
  final Value<int> rowid;
  const LocalSyncCursorsCompanion({
    this.conversationId = const Value.absent(),
    this.lastMessageId = const Value.absent(),
    this.lastSyncedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  LocalSyncCursorsCompanion.insert({
    required String conversationId,
    this.lastMessageId = const Value.absent(),
    required DateTime lastSyncedAt,
    this.rowid = const Value.absent(),
  }) : conversationId = Value(conversationId),
       lastSyncedAt = Value(lastSyncedAt);
  static Insertable<LocalSyncCursor> custom({
    Expression<String>? conversationId,
    Expression<String>? lastMessageId,
    Expression<DateTime>? lastSyncedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (conversationId != null) 'conversation_id': conversationId,
      if (lastMessageId != null) 'last_message_id': lastMessageId,
      if (lastSyncedAt != null) 'last_synced_at': lastSyncedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  LocalSyncCursorsCompanion copyWith({
    Value<String>? conversationId,
    Value<String?>? lastMessageId,
    Value<DateTime>? lastSyncedAt,
    Value<int>? rowid,
  }) {
    return LocalSyncCursorsCompanion(
      conversationId: conversationId ?? this.conversationId,
      lastMessageId: lastMessageId ?? this.lastMessageId,
      lastSyncedAt: lastSyncedAt ?? this.lastSyncedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (conversationId.present) {
      map['conversation_id'] = Variable<String>(conversationId.value);
    }
    if (lastMessageId.present) {
      map['last_message_id'] = Variable<String>(lastMessageId.value);
    }
    if (lastSyncedAt.present) {
      map['last_synced_at'] = Variable<DateTime>(lastSyncedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('LocalSyncCursorsCompanion(')
          ..write('conversationId: $conversationId, ')
          ..write('lastMessageId: $lastMessageId, ')
          ..write('lastSyncedAt: $lastSyncedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $LocalCachePreferencesTable extends LocalCachePreferences
    with TableInfo<$LocalCachePreferencesTable, LocalCachePreference> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $LocalCachePreferencesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(1),
  );
  static const VerificationMeta _autoDownloadImagesMeta =
      const VerificationMeta('autoDownloadImages');
  @override
  late final GeneratedColumn<bool> autoDownloadImages = GeneratedColumn<bool>(
    'auto_download_images',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("auto_download_images" IN (0, 1))',
    ),
    defaultValue: const Constant(true),
  );
  static const VerificationMeta _autoDownloadDocumentsMeta =
      const VerificationMeta('autoDownloadDocuments');
  @override
  late final GeneratedColumn<bool> autoDownloadDocuments =
      GeneratedColumn<bool>(
        'auto_download_documents',
        aliasedName,
        false,
        type: DriftSqlType.bool,
        requiredDuringInsert: false,
        defaultConstraints: GeneratedColumn.constraintIsAlways(
          'CHECK ("auto_download_documents" IN (0, 1))',
        ),
        defaultValue: const Constant(false),
      );
  static const VerificationMeta _keepOnLogoutMeta = const VerificationMeta(
    'keepOnLogout',
  );
  @override
  late final GeneratedColumn<bool> keepOnLogout = GeneratedColumn<bool>(
    'keep_on_logout',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("keep_on_logout" IN (0, 1))',
    ),
    defaultValue: const Constant(false),
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    autoDownloadImages,
    autoDownloadDocuments,
    keepOnLogout,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'local_cache_preferences';
  @override
  VerificationContext validateIntegrity(
    Insertable<LocalCachePreference> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('auto_download_images')) {
      context.handle(
        _autoDownloadImagesMeta,
        autoDownloadImages.isAcceptableOrUnknown(
          data['auto_download_images']!,
          _autoDownloadImagesMeta,
        ),
      );
    }
    if (data.containsKey('auto_download_documents')) {
      context.handle(
        _autoDownloadDocumentsMeta,
        autoDownloadDocuments.isAcceptableOrUnknown(
          data['auto_download_documents']!,
          _autoDownloadDocumentsMeta,
        ),
      );
    }
    if (data.containsKey('keep_on_logout')) {
      context.handle(
        _keepOnLogoutMeta,
        keepOnLogout.isAcceptableOrUnknown(
          data['keep_on_logout']!,
          _keepOnLogoutMeta,
        ),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  LocalCachePreference map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return LocalCachePreference(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}id'],
      )!,
      autoDownloadImages: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}auto_download_images'],
      )!,
      autoDownloadDocuments: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}auto_download_documents'],
      )!,
      keepOnLogout: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}keep_on_logout'],
      )!,
    );
  }

  @override
  $LocalCachePreferencesTable createAlias(String alias) {
    return $LocalCachePreferencesTable(attachedDatabase, alias);
  }
}

class LocalCachePreference extends DataClass
    implements Insertable<LocalCachePreference> {
  final int id;
  final bool autoDownloadImages;
  final bool autoDownloadDocuments;
  final bool keepOnLogout;
  const LocalCachePreference({
    required this.id,
    required this.autoDownloadImages,
    required this.autoDownloadDocuments,
    required this.keepOnLogout,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['auto_download_images'] = Variable<bool>(autoDownloadImages);
    map['auto_download_documents'] = Variable<bool>(autoDownloadDocuments);
    map['keep_on_logout'] = Variable<bool>(keepOnLogout);
    return map;
  }

  LocalCachePreferencesCompanion toCompanion(bool nullToAbsent) {
    return LocalCachePreferencesCompanion(
      id: Value(id),
      autoDownloadImages: Value(autoDownloadImages),
      autoDownloadDocuments: Value(autoDownloadDocuments),
      keepOnLogout: Value(keepOnLogout),
    );
  }

  factory LocalCachePreference.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return LocalCachePreference(
      id: serializer.fromJson<int>(json['id']),
      autoDownloadImages: serializer.fromJson<bool>(json['autoDownloadImages']),
      autoDownloadDocuments: serializer.fromJson<bool>(
        json['autoDownloadDocuments'],
      ),
      keepOnLogout: serializer.fromJson<bool>(json['keepOnLogout']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'autoDownloadImages': serializer.toJson<bool>(autoDownloadImages),
      'autoDownloadDocuments': serializer.toJson<bool>(autoDownloadDocuments),
      'keepOnLogout': serializer.toJson<bool>(keepOnLogout),
    };
  }

  LocalCachePreference copyWith({
    int? id,
    bool? autoDownloadImages,
    bool? autoDownloadDocuments,
    bool? keepOnLogout,
  }) => LocalCachePreference(
    id: id ?? this.id,
    autoDownloadImages: autoDownloadImages ?? this.autoDownloadImages,
    autoDownloadDocuments: autoDownloadDocuments ?? this.autoDownloadDocuments,
    keepOnLogout: keepOnLogout ?? this.keepOnLogout,
  );
  LocalCachePreference copyWithCompanion(LocalCachePreferencesCompanion data) {
    return LocalCachePreference(
      id: data.id.present ? data.id.value : this.id,
      autoDownloadImages: data.autoDownloadImages.present
          ? data.autoDownloadImages.value
          : this.autoDownloadImages,
      autoDownloadDocuments: data.autoDownloadDocuments.present
          ? data.autoDownloadDocuments.value
          : this.autoDownloadDocuments,
      keepOnLogout: data.keepOnLogout.present
          ? data.keepOnLogout.value
          : this.keepOnLogout,
    );
  }

  @override
  String toString() {
    return (StringBuffer('LocalCachePreference(')
          ..write('id: $id, ')
          ..write('autoDownloadImages: $autoDownloadImages, ')
          ..write('autoDownloadDocuments: $autoDownloadDocuments, ')
          ..write('keepOnLogout: $keepOnLogout')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode =>
      Object.hash(id, autoDownloadImages, autoDownloadDocuments, keepOnLogout);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is LocalCachePreference &&
          other.id == this.id &&
          other.autoDownloadImages == this.autoDownloadImages &&
          other.autoDownloadDocuments == this.autoDownloadDocuments &&
          other.keepOnLogout == this.keepOnLogout);
}

class LocalCachePreferencesCompanion
    extends UpdateCompanion<LocalCachePreference> {
  final Value<int> id;
  final Value<bool> autoDownloadImages;
  final Value<bool> autoDownloadDocuments;
  final Value<bool> keepOnLogout;
  const LocalCachePreferencesCompanion({
    this.id = const Value.absent(),
    this.autoDownloadImages = const Value.absent(),
    this.autoDownloadDocuments = const Value.absent(),
    this.keepOnLogout = const Value.absent(),
  });
  LocalCachePreferencesCompanion.insert({
    this.id = const Value.absent(),
    this.autoDownloadImages = const Value.absent(),
    this.autoDownloadDocuments = const Value.absent(),
    this.keepOnLogout = const Value.absent(),
  });
  static Insertable<LocalCachePreference> custom({
    Expression<int>? id,
    Expression<bool>? autoDownloadImages,
    Expression<bool>? autoDownloadDocuments,
    Expression<bool>? keepOnLogout,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (autoDownloadImages != null)
        'auto_download_images': autoDownloadImages,
      if (autoDownloadDocuments != null)
        'auto_download_documents': autoDownloadDocuments,
      if (keepOnLogout != null) 'keep_on_logout': keepOnLogout,
    });
  }

  LocalCachePreferencesCompanion copyWith({
    Value<int>? id,
    Value<bool>? autoDownloadImages,
    Value<bool>? autoDownloadDocuments,
    Value<bool>? keepOnLogout,
  }) {
    return LocalCachePreferencesCompanion(
      id: id ?? this.id,
      autoDownloadImages: autoDownloadImages ?? this.autoDownloadImages,
      autoDownloadDocuments:
          autoDownloadDocuments ?? this.autoDownloadDocuments,
      keepOnLogout: keepOnLogout ?? this.keepOnLogout,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (autoDownloadImages.present) {
      map['auto_download_images'] = Variable<bool>(autoDownloadImages.value);
    }
    if (autoDownloadDocuments.present) {
      map['auto_download_documents'] = Variable<bool>(
        autoDownloadDocuments.value,
      );
    }
    if (keepOnLogout.present) {
      map['keep_on_logout'] = Variable<bool>(keepOnLogout.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('LocalCachePreferencesCompanion(')
          ..write('id: $id, ')
          ..write('autoDownloadImages: $autoDownloadImages, ')
          ..write('autoDownloadDocuments: $autoDownloadDocuments, ')
          ..write('keepOnLogout: $keepOnLogout')
          ..write(')'))
        .toString();
  }
}

class $LocalAiConversationsTable extends LocalAiConversations
    with TableInfo<$LocalAiConversationsTable, LocalAiConversation> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $LocalAiConversationsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _encryptedPayloadMeta = const VerificationMeta(
    'encryptedPayload',
  );
  @override
  late final GeneratedColumn<String> encryptedPayload = GeneratedColumn<String>(
    'encrypted_payload',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _updatedAtMeta = const VerificationMeta(
    'updatedAt',
  );
  @override
  late final GeneratedColumn<DateTime> updatedAt = GeneratedColumn<DateTime>(
    'updated_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [id, encryptedPayload, updatedAt];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'local_ai_conversations';
  @override
  VerificationContext validateIntegrity(
    Insertable<LocalAiConversation> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('encrypted_payload')) {
      context.handle(
        _encryptedPayloadMeta,
        encryptedPayload.isAcceptableOrUnknown(
          data['encrypted_payload']!,
          _encryptedPayloadMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_encryptedPayloadMeta);
    }
    if (data.containsKey('updated_at')) {
      context.handle(
        _updatedAtMeta,
        updatedAt.isAcceptableOrUnknown(data['updated_at']!, _updatedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_updatedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  LocalAiConversation map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return LocalAiConversation(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}id'],
      )!,
      encryptedPayload: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}encrypted_payload'],
      )!,
      updatedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}updated_at'],
      )!,
    );
  }

  @override
  $LocalAiConversationsTable createAlias(String alias) {
    return $LocalAiConversationsTable(attachedDatabase, alias);
  }
}

class LocalAiConversation extends DataClass
    implements Insertable<LocalAiConversation> {
  final String id;
  final String encryptedPayload;
  final DateTime updatedAt;
  const LocalAiConversation({
    required this.id,
    required this.encryptedPayload,
    required this.updatedAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['encrypted_payload'] = Variable<String>(encryptedPayload);
    map['updated_at'] = Variable<DateTime>(updatedAt);
    return map;
  }

  LocalAiConversationsCompanion toCompanion(bool nullToAbsent) {
    return LocalAiConversationsCompanion(
      id: Value(id),
      encryptedPayload: Value(encryptedPayload),
      updatedAt: Value(updatedAt),
    );
  }

  factory LocalAiConversation.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return LocalAiConversation(
      id: serializer.fromJson<String>(json['id']),
      encryptedPayload: serializer.fromJson<String>(json['encryptedPayload']),
      updatedAt: serializer.fromJson<DateTime>(json['updatedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'encryptedPayload': serializer.toJson<String>(encryptedPayload),
      'updatedAt': serializer.toJson<DateTime>(updatedAt),
    };
  }

  LocalAiConversation copyWith({
    String? id,
    String? encryptedPayload,
    DateTime? updatedAt,
  }) => LocalAiConversation(
    id: id ?? this.id,
    encryptedPayload: encryptedPayload ?? this.encryptedPayload,
    updatedAt: updatedAt ?? this.updatedAt,
  );
  LocalAiConversation copyWithCompanion(LocalAiConversationsCompanion data) {
    return LocalAiConversation(
      id: data.id.present ? data.id.value : this.id,
      encryptedPayload: data.encryptedPayload.present
          ? data.encryptedPayload.value
          : this.encryptedPayload,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('LocalAiConversation(')
          ..write('id: $id, ')
          ..write('encryptedPayload: $encryptedPayload, ')
          ..write('updatedAt: $updatedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, encryptedPayload, updatedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is LocalAiConversation &&
          other.id == this.id &&
          other.encryptedPayload == this.encryptedPayload &&
          other.updatedAt == this.updatedAt);
}

class LocalAiConversationsCompanion
    extends UpdateCompanion<LocalAiConversation> {
  final Value<String> id;
  final Value<String> encryptedPayload;
  final Value<DateTime> updatedAt;
  final Value<int> rowid;
  const LocalAiConversationsCompanion({
    this.id = const Value.absent(),
    this.encryptedPayload = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  LocalAiConversationsCompanion.insert({
    required String id,
    required String encryptedPayload,
    required DateTime updatedAt,
    this.rowid = const Value.absent(),
  }) : id = Value(id),
       encryptedPayload = Value(encryptedPayload),
       updatedAt = Value(updatedAt);
  static Insertable<LocalAiConversation> custom({
    Expression<String>? id,
    Expression<String>? encryptedPayload,
    Expression<DateTime>? updatedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (encryptedPayload != null) 'encrypted_payload': encryptedPayload,
      if (updatedAt != null) 'updated_at': updatedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  LocalAiConversationsCompanion copyWith({
    Value<String>? id,
    Value<String>? encryptedPayload,
    Value<DateTime>? updatedAt,
    Value<int>? rowid,
  }) {
    return LocalAiConversationsCompanion(
      id: id ?? this.id,
      encryptedPayload: encryptedPayload ?? this.encryptedPayload,
      updatedAt: updatedAt ?? this.updatedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (encryptedPayload.present) {
      map['encrypted_payload'] = Variable<String>(encryptedPayload.value);
    }
    if (updatedAt.present) {
      map['updated_at'] = Variable<DateTime>(updatedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('LocalAiConversationsCompanion(')
          ..write('id: $id, ')
          ..write('encryptedPayload: $encryptedPayload, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $LocalAiMessagesTable extends LocalAiMessages
    with TableInfo<$LocalAiMessagesTable, LocalAiMessage> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $LocalAiMessagesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _conversationIdMeta = const VerificationMeta(
    'conversationId',
  );
  @override
  late final GeneratedColumn<String> conversationId = GeneratedColumn<String>(
    'conversation_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _encryptedPayloadMeta = const VerificationMeta(
    'encryptedPayload',
  );
  @override
  late final GeneratedColumn<String> encryptedPayload = GeneratedColumn<String>(
    'encrypted_payload',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _stateMeta = const VerificationMeta('state');
  @override
  late final GeneratedColumn<String> state = GeneratedColumn<String>(
    'state',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant('COMPLETED'),
  );
  static const VerificationMeta _createdAtMeta = const VerificationMeta(
    'createdAt',
  );
  @override
  late final GeneratedColumn<DateTime> createdAt = GeneratedColumn<DateTime>(
    'created_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    conversationId,
    encryptedPayload,
    state,
    createdAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'local_ai_messages';
  @override
  VerificationContext validateIntegrity(
    Insertable<LocalAiMessage> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('conversation_id')) {
      context.handle(
        _conversationIdMeta,
        conversationId.isAcceptableOrUnknown(
          data['conversation_id']!,
          _conversationIdMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_conversationIdMeta);
    }
    if (data.containsKey('encrypted_payload')) {
      context.handle(
        _encryptedPayloadMeta,
        encryptedPayload.isAcceptableOrUnknown(
          data['encrypted_payload']!,
          _encryptedPayloadMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_encryptedPayloadMeta);
    }
    if (data.containsKey('state')) {
      context.handle(
        _stateMeta,
        state.isAcceptableOrUnknown(data['state']!, _stateMeta),
      );
    }
    if (data.containsKey('created_at')) {
      context.handle(
        _createdAtMeta,
        createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta),
      );
    } else if (isInserting) {
      context.missing(_createdAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  LocalAiMessage map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return LocalAiMessage(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}id'],
      )!,
      conversationId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}conversation_id'],
      )!,
      encryptedPayload: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}encrypted_payload'],
      )!,
      state: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}state'],
      )!,
      createdAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}created_at'],
      )!,
    );
  }

  @override
  $LocalAiMessagesTable createAlias(String alias) {
    return $LocalAiMessagesTable(attachedDatabase, alias);
  }
}

class LocalAiMessage extends DataClass implements Insertable<LocalAiMessage> {
  final String id;
  final String conversationId;
  final String encryptedPayload;
  final String state;
  final DateTime createdAt;
  const LocalAiMessage({
    required this.id,
    required this.conversationId,
    required this.encryptedPayload,
    required this.state,
    required this.createdAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['conversation_id'] = Variable<String>(conversationId);
    map['encrypted_payload'] = Variable<String>(encryptedPayload);
    map['state'] = Variable<String>(state);
    map['created_at'] = Variable<DateTime>(createdAt);
    return map;
  }

  LocalAiMessagesCompanion toCompanion(bool nullToAbsent) {
    return LocalAiMessagesCompanion(
      id: Value(id),
      conversationId: Value(conversationId),
      encryptedPayload: Value(encryptedPayload),
      state: Value(state),
      createdAt: Value(createdAt),
    );
  }

  factory LocalAiMessage.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return LocalAiMessage(
      id: serializer.fromJson<String>(json['id']),
      conversationId: serializer.fromJson<String>(json['conversationId']),
      encryptedPayload: serializer.fromJson<String>(json['encryptedPayload']),
      state: serializer.fromJson<String>(json['state']),
      createdAt: serializer.fromJson<DateTime>(json['createdAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'conversationId': serializer.toJson<String>(conversationId),
      'encryptedPayload': serializer.toJson<String>(encryptedPayload),
      'state': serializer.toJson<String>(state),
      'createdAt': serializer.toJson<DateTime>(createdAt),
    };
  }

  LocalAiMessage copyWith({
    String? id,
    String? conversationId,
    String? encryptedPayload,
    String? state,
    DateTime? createdAt,
  }) => LocalAiMessage(
    id: id ?? this.id,
    conversationId: conversationId ?? this.conversationId,
    encryptedPayload: encryptedPayload ?? this.encryptedPayload,
    state: state ?? this.state,
    createdAt: createdAt ?? this.createdAt,
  );
  LocalAiMessage copyWithCompanion(LocalAiMessagesCompanion data) {
    return LocalAiMessage(
      id: data.id.present ? data.id.value : this.id,
      conversationId: data.conversationId.present
          ? data.conversationId.value
          : this.conversationId,
      encryptedPayload: data.encryptedPayload.present
          ? data.encryptedPayload.value
          : this.encryptedPayload,
      state: data.state.present ? data.state.value : this.state,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('LocalAiMessage(')
          ..write('id: $id, ')
          ..write('conversationId: $conversationId, ')
          ..write('encryptedPayload: $encryptedPayload, ')
          ..write('state: $state, ')
          ..write('createdAt: $createdAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode =>
      Object.hash(id, conversationId, encryptedPayload, state, createdAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is LocalAiMessage &&
          other.id == this.id &&
          other.conversationId == this.conversationId &&
          other.encryptedPayload == this.encryptedPayload &&
          other.state == this.state &&
          other.createdAt == this.createdAt);
}

class LocalAiMessagesCompanion extends UpdateCompanion<LocalAiMessage> {
  final Value<String> id;
  final Value<String> conversationId;
  final Value<String> encryptedPayload;
  final Value<String> state;
  final Value<DateTime> createdAt;
  final Value<int> rowid;
  const LocalAiMessagesCompanion({
    this.id = const Value.absent(),
    this.conversationId = const Value.absent(),
    this.encryptedPayload = const Value.absent(),
    this.state = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  LocalAiMessagesCompanion.insert({
    required String id,
    required String conversationId,
    required String encryptedPayload,
    this.state = const Value.absent(),
    required DateTime createdAt,
    this.rowid = const Value.absent(),
  }) : id = Value(id),
       conversationId = Value(conversationId),
       encryptedPayload = Value(encryptedPayload),
       createdAt = Value(createdAt);
  static Insertable<LocalAiMessage> custom({
    Expression<String>? id,
    Expression<String>? conversationId,
    Expression<String>? encryptedPayload,
    Expression<String>? state,
    Expression<DateTime>? createdAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (conversationId != null) 'conversation_id': conversationId,
      if (encryptedPayload != null) 'encrypted_payload': encryptedPayload,
      if (state != null) 'state': state,
      if (createdAt != null) 'created_at': createdAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  LocalAiMessagesCompanion copyWith({
    Value<String>? id,
    Value<String>? conversationId,
    Value<String>? encryptedPayload,
    Value<String>? state,
    Value<DateTime>? createdAt,
    Value<int>? rowid,
  }) {
    return LocalAiMessagesCompanion(
      id: id ?? this.id,
      conversationId: conversationId ?? this.conversationId,
      encryptedPayload: encryptedPayload ?? this.encryptedPayload,
      state: state ?? this.state,
      createdAt: createdAt ?? this.createdAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (conversationId.present) {
      map['conversation_id'] = Variable<String>(conversationId.value);
    }
    if (encryptedPayload.present) {
      map['encrypted_payload'] = Variable<String>(encryptedPayload.value);
    }
    if (state.present) {
      map['state'] = Variable<String>(state.value);
    }
    if (createdAt.present) {
      map['created_at'] = Variable<DateTime>(createdAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('LocalAiMessagesCompanion(')
          ..write('id: $id, ')
          ..write('conversationId: $conversationId, ')
          ..write('encryptedPayload: $encryptedPayload, ')
          ..write('state: $state, ')
          ..write('createdAt: $createdAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $LocalAiDraftsTable extends LocalAiDrafts
    with TableInfo<$LocalAiDraftsTable, LocalAiDraft> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $LocalAiDraftsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _conversationIdMeta = const VerificationMeta(
    'conversationId',
  );
  @override
  late final GeneratedColumn<String> conversationId = GeneratedColumn<String>(
    'conversation_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _encryptedPayloadMeta = const VerificationMeta(
    'encryptedPayload',
  );
  @override
  late final GeneratedColumn<String> encryptedPayload = GeneratedColumn<String>(
    'encrypted_payload',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _updatedAtMeta = const VerificationMeta(
    'updatedAt',
  );
  @override
  late final GeneratedColumn<DateTime> updatedAt = GeneratedColumn<DateTime>(
    'updated_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    conversationId,
    encryptedPayload,
    updatedAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'local_ai_drafts';
  @override
  VerificationContext validateIntegrity(
    Insertable<LocalAiDraft> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('conversation_id')) {
      context.handle(
        _conversationIdMeta,
        conversationId.isAcceptableOrUnknown(
          data['conversation_id']!,
          _conversationIdMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_conversationIdMeta);
    }
    if (data.containsKey('encrypted_payload')) {
      context.handle(
        _encryptedPayloadMeta,
        encryptedPayload.isAcceptableOrUnknown(
          data['encrypted_payload']!,
          _encryptedPayloadMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_encryptedPayloadMeta);
    }
    if (data.containsKey('updated_at')) {
      context.handle(
        _updatedAtMeta,
        updatedAt.isAcceptableOrUnknown(data['updated_at']!, _updatedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_updatedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {conversationId};
  @override
  LocalAiDraft map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return LocalAiDraft(
      conversationId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}conversation_id'],
      )!,
      encryptedPayload: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}encrypted_payload'],
      )!,
      updatedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}updated_at'],
      )!,
    );
  }

  @override
  $LocalAiDraftsTable createAlias(String alias) {
    return $LocalAiDraftsTable(attachedDatabase, alias);
  }
}

class LocalAiDraft extends DataClass implements Insertable<LocalAiDraft> {
  final String conversationId;
  final String encryptedPayload;
  final DateTime updatedAt;
  const LocalAiDraft({
    required this.conversationId,
    required this.encryptedPayload,
    required this.updatedAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['conversation_id'] = Variable<String>(conversationId);
    map['encrypted_payload'] = Variable<String>(encryptedPayload);
    map['updated_at'] = Variable<DateTime>(updatedAt);
    return map;
  }

  LocalAiDraftsCompanion toCompanion(bool nullToAbsent) {
    return LocalAiDraftsCompanion(
      conversationId: Value(conversationId),
      encryptedPayload: Value(encryptedPayload),
      updatedAt: Value(updatedAt),
    );
  }

  factory LocalAiDraft.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return LocalAiDraft(
      conversationId: serializer.fromJson<String>(json['conversationId']),
      encryptedPayload: serializer.fromJson<String>(json['encryptedPayload']),
      updatedAt: serializer.fromJson<DateTime>(json['updatedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'conversationId': serializer.toJson<String>(conversationId),
      'encryptedPayload': serializer.toJson<String>(encryptedPayload),
      'updatedAt': serializer.toJson<DateTime>(updatedAt),
    };
  }

  LocalAiDraft copyWith({
    String? conversationId,
    String? encryptedPayload,
    DateTime? updatedAt,
  }) => LocalAiDraft(
    conversationId: conversationId ?? this.conversationId,
    encryptedPayload: encryptedPayload ?? this.encryptedPayload,
    updatedAt: updatedAt ?? this.updatedAt,
  );
  LocalAiDraft copyWithCompanion(LocalAiDraftsCompanion data) {
    return LocalAiDraft(
      conversationId: data.conversationId.present
          ? data.conversationId.value
          : this.conversationId,
      encryptedPayload: data.encryptedPayload.present
          ? data.encryptedPayload.value
          : this.encryptedPayload,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('LocalAiDraft(')
          ..write('conversationId: $conversationId, ')
          ..write('encryptedPayload: $encryptedPayload, ')
          ..write('updatedAt: $updatedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(conversationId, encryptedPayload, updatedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is LocalAiDraft &&
          other.conversationId == this.conversationId &&
          other.encryptedPayload == this.encryptedPayload &&
          other.updatedAt == this.updatedAt);
}

class LocalAiDraftsCompanion extends UpdateCompanion<LocalAiDraft> {
  final Value<String> conversationId;
  final Value<String> encryptedPayload;
  final Value<DateTime> updatedAt;
  final Value<int> rowid;
  const LocalAiDraftsCompanion({
    this.conversationId = const Value.absent(),
    this.encryptedPayload = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  LocalAiDraftsCompanion.insert({
    required String conversationId,
    required String encryptedPayload,
    required DateTime updatedAt,
    this.rowid = const Value.absent(),
  }) : conversationId = Value(conversationId),
       encryptedPayload = Value(encryptedPayload),
       updatedAt = Value(updatedAt);
  static Insertable<LocalAiDraft> custom({
    Expression<String>? conversationId,
    Expression<String>? encryptedPayload,
    Expression<DateTime>? updatedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (conversationId != null) 'conversation_id': conversationId,
      if (encryptedPayload != null) 'encrypted_payload': encryptedPayload,
      if (updatedAt != null) 'updated_at': updatedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  LocalAiDraftsCompanion copyWith({
    Value<String>? conversationId,
    Value<String>? encryptedPayload,
    Value<DateTime>? updatedAt,
    Value<int>? rowid,
  }) {
    return LocalAiDraftsCompanion(
      conversationId: conversationId ?? this.conversationId,
      encryptedPayload: encryptedPayload ?? this.encryptedPayload,
      updatedAt: updatedAt ?? this.updatedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (conversationId.present) {
      map['conversation_id'] = Variable<String>(conversationId.value);
    }
    if (encryptedPayload.present) {
      map['encrypted_payload'] = Variable<String>(encryptedPayload.value);
    }
    if (updatedAt.present) {
      map['updated_at'] = Variable<DateTime>(updatedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('LocalAiDraftsCompanion(')
          ..write('conversationId: $conversationId, ')
          ..write('encryptedPayload: $encryptedPayload, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

abstract class _$AvsLocalDatabase extends GeneratedDatabase {
  _$AvsLocalDatabase(QueryExecutor e) : super(e);
  $AvsLocalDatabaseManager get managers => $AvsLocalDatabaseManager(this);
  late final $LocalConversationsTable localConversations =
      $LocalConversationsTable(this);
  late final $LocalMessagesTable localMessages = $LocalMessagesTable(this);
  late final $PendingMessageOperationsTable pendingMessageOperations =
      $PendingMessageOperationsTable(this);
  late final $LocalDraftsTable localDrafts = $LocalDraftsTable(this);
  late final $LocalSyncCursorsTable localSyncCursors = $LocalSyncCursorsTable(
    this,
  );
  late final $LocalCachePreferencesTable localCachePreferences =
      $LocalCachePreferencesTable(this);
  late final $LocalAiConversationsTable localAiConversations =
      $LocalAiConversationsTable(this);
  late final $LocalAiMessagesTable localAiMessages = $LocalAiMessagesTable(
    this,
  );
  late final $LocalAiDraftsTable localAiDrafts = $LocalAiDraftsTable(this);
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [
    localConversations,
    localMessages,
    pendingMessageOperations,
    localDrafts,
    localSyncCursors,
    localCachePreferences,
    localAiConversations,
    localAiMessages,
    localAiDrafts,
  ];
}

typedef $$LocalConversationsTableCreateCompanionBuilder =
    LocalConversationsCompanion Function({
      required String id,
      required String encryptedPayload,
      required DateTime updatedAt,
      Value<int> rowid,
    });
typedef $$LocalConversationsTableUpdateCompanionBuilder =
    LocalConversationsCompanion Function({
      Value<String> id,
      Value<String> encryptedPayload,
      Value<DateTime> updatedAt,
      Value<int> rowid,
    });

class $$LocalConversationsTableFilterComposer
    extends Composer<_$AvsLocalDatabase, $LocalConversationsTable> {
  $$LocalConversationsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get encryptedPayload => $composableBuilder(
    column: $table.encryptedPayload,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$LocalConversationsTableOrderingComposer
    extends Composer<_$AvsLocalDatabase, $LocalConversationsTable> {
  $$LocalConversationsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get encryptedPayload => $composableBuilder(
    column: $table.encryptedPayload,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$LocalConversationsTableAnnotationComposer
    extends Composer<_$AvsLocalDatabase, $LocalConversationsTable> {
  $$LocalConversationsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get encryptedPayload => $composableBuilder(
    column: $table.encryptedPayload,
    builder: (column) => column,
  );

  GeneratedColumn<DateTime> get updatedAt =>
      $composableBuilder(column: $table.updatedAt, builder: (column) => column);
}

class $$LocalConversationsTableTableManager
    extends
        RootTableManager<
          _$AvsLocalDatabase,
          $LocalConversationsTable,
          LocalConversation,
          $$LocalConversationsTableFilterComposer,
          $$LocalConversationsTableOrderingComposer,
          $$LocalConversationsTableAnnotationComposer,
          $$LocalConversationsTableCreateCompanionBuilder,
          $$LocalConversationsTableUpdateCompanionBuilder,
          (
            LocalConversation,
            BaseReferences<
              _$AvsLocalDatabase,
              $LocalConversationsTable,
              LocalConversation
            >,
          ),
          LocalConversation,
          PrefetchHooks Function()
        > {
  $$LocalConversationsTableTableManager(
    _$AvsLocalDatabase db,
    $LocalConversationsTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$LocalConversationsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$LocalConversationsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$LocalConversationsTableAnnotationComposer(
                $db: db,
                $table: table,
              ),
          updateCompanionCallback:
              ({
                Value<String> id = const Value.absent(),
                Value<String> encryptedPayload = const Value.absent(),
                Value<DateTime> updatedAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => LocalConversationsCompanion(
                id: id,
                encryptedPayload: encryptedPayload,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String id,
                required String encryptedPayload,
                required DateTime updatedAt,
                Value<int> rowid = const Value.absent(),
              }) => LocalConversationsCompanion.insert(
                id: id,
                encryptedPayload: encryptedPayload,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$LocalConversationsTableProcessedTableManager =
    ProcessedTableManager<
      _$AvsLocalDatabase,
      $LocalConversationsTable,
      LocalConversation,
      $$LocalConversationsTableFilterComposer,
      $$LocalConversationsTableOrderingComposer,
      $$LocalConversationsTableAnnotationComposer,
      $$LocalConversationsTableCreateCompanionBuilder,
      $$LocalConversationsTableUpdateCompanionBuilder,
      (
        LocalConversation,
        BaseReferences<
          _$AvsLocalDatabase,
          $LocalConversationsTable,
          LocalConversation
        >,
      ),
      LocalConversation,
      PrefetchHooks Function()
    >;
typedef $$LocalMessagesTableCreateCompanionBuilder =
    LocalMessagesCompanion Function({
      required String id,
      required String conversationId,
      required String encryptedPayload,
      Value<String> state,
      required DateTime createdAt,
      Value<int> rowid,
    });
typedef $$LocalMessagesTableUpdateCompanionBuilder =
    LocalMessagesCompanion Function({
      Value<String> id,
      Value<String> conversationId,
      Value<String> encryptedPayload,
      Value<String> state,
      Value<DateTime> createdAt,
      Value<int> rowid,
    });

class $$LocalMessagesTableFilterComposer
    extends Composer<_$AvsLocalDatabase, $LocalMessagesTable> {
  $$LocalMessagesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get conversationId => $composableBuilder(
    column: $table.conversationId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get encryptedPayload => $composableBuilder(
    column: $table.encryptedPayload,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get state => $composableBuilder(
    column: $table.state,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$LocalMessagesTableOrderingComposer
    extends Composer<_$AvsLocalDatabase, $LocalMessagesTable> {
  $$LocalMessagesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get conversationId => $composableBuilder(
    column: $table.conversationId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get encryptedPayload => $composableBuilder(
    column: $table.encryptedPayload,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get state => $composableBuilder(
    column: $table.state,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$LocalMessagesTableAnnotationComposer
    extends Composer<_$AvsLocalDatabase, $LocalMessagesTable> {
  $$LocalMessagesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get conversationId => $composableBuilder(
    column: $table.conversationId,
    builder: (column) => column,
  );

  GeneratedColumn<String> get encryptedPayload => $composableBuilder(
    column: $table.encryptedPayload,
    builder: (column) => column,
  );

  GeneratedColumn<String> get state =>
      $composableBuilder(column: $table.state, builder: (column) => column);

  GeneratedColumn<DateTime> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);
}

class $$LocalMessagesTableTableManager
    extends
        RootTableManager<
          _$AvsLocalDatabase,
          $LocalMessagesTable,
          LocalMessage,
          $$LocalMessagesTableFilterComposer,
          $$LocalMessagesTableOrderingComposer,
          $$LocalMessagesTableAnnotationComposer,
          $$LocalMessagesTableCreateCompanionBuilder,
          $$LocalMessagesTableUpdateCompanionBuilder,
          (
            LocalMessage,
            BaseReferences<
              _$AvsLocalDatabase,
              $LocalMessagesTable,
              LocalMessage
            >,
          ),
          LocalMessage,
          PrefetchHooks Function()
        > {
  $$LocalMessagesTableTableManager(
    _$AvsLocalDatabase db,
    $LocalMessagesTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$LocalMessagesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$LocalMessagesTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$LocalMessagesTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> id = const Value.absent(),
                Value<String> conversationId = const Value.absent(),
                Value<String> encryptedPayload = const Value.absent(),
                Value<String> state = const Value.absent(),
                Value<DateTime> createdAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => LocalMessagesCompanion(
                id: id,
                conversationId: conversationId,
                encryptedPayload: encryptedPayload,
                state: state,
                createdAt: createdAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String id,
                required String conversationId,
                required String encryptedPayload,
                Value<String> state = const Value.absent(),
                required DateTime createdAt,
                Value<int> rowid = const Value.absent(),
              }) => LocalMessagesCompanion.insert(
                id: id,
                conversationId: conversationId,
                encryptedPayload: encryptedPayload,
                state: state,
                createdAt: createdAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$LocalMessagesTableProcessedTableManager =
    ProcessedTableManager<
      _$AvsLocalDatabase,
      $LocalMessagesTable,
      LocalMessage,
      $$LocalMessagesTableFilterComposer,
      $$LocalMessagesTableOrderingComposer,
      $$LocalMessagesTableAnnotationComposer,
      $$LocalMessagesTableCreateCompanionBuilder,
      $$LocalMessagesTableUpdateCompanionBuilder,
      (
        LocalMessage,
        BaseReferences<_$AvsLocalDatabase, $LocalMessagesTable, LocalMessage>,
      ),
      LocalMessage,
      PrefetchHooks Function()
    >;
typedef $$PendingMessageOperationsTableCreateCompanionBuilder =
    PendingMessageOperationsCompanion Function({
      required String id,
      required String conversationId,
      required String encryptedPayload,
      required String state,
      required DateTime updatedAt,
      Value<int> rowid,
    });
typedef $$PendingMessageOperationsTableUpdateCompanionBuilder =
    PendingMessageOperationsCompanion Function({
      Value<String> id,
      Value<String> conversationId,
      Value<String> encryptedPayload,
      Value<String> state,
      Value<DateTime> updatedAt,
      Value<int> rowid,
    });

class $$PendingMessageOperationsTableFilterComposer
    extends Composer<_$AvsLocalDatabase, $PendingMessageOperationsTable> {
  $$PendingMessageOperationsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get conversationId => $composableBuilder(
    column: $table.conversationId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get encryptedPayload => $composableBuilder(
    column: $table.encryptedPayload,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get state => $composableBuilder(
    column: $table.state,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$PendingMessageOperationsTableOrderingComposer
    extends Composer<_$AvsLocalDatabase, $PendingMessageOperationsTable> {
  $$PendingMessageOperationsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get conversationId => $composableBuilder(
    column: $table.conversationId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get encryptedPayload => $composableBuilder(
    column: $table.encryptedPayload,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get state => $composableBuilder(
    column: $table.state,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$PendingMessageOperationsTableAnnotationComposer
    extends Composer<_$AvsLocalDatabase, $PendingMessageOperationsTable> {
  $$PendingMessageOperationsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get conversationId => $composableBuilder(
    column: $table.conversationId,
    builder: (column) => column,
  );

  GeneratedColumn<String> get encryptedPayload => $composableBuilder(
    column: $table.encryptedPayload,
    builder: (column) => column,
  );

  GeneratedColumn<String> get state =>
      $composableBuilder(column: $table.state, builder: (column) => column);

  GeneratedColumn<DateTime> get updatedAt =>
      $composableBuilder(column: $table.updatedAt, builder: (column) => column);
}

class $$PendingMessageOperationsTableTableManager
    extends
        RootTableManager<
          _$AvsLocalDatabase,
          $PendingMessageOperationsTable,
          PendingMessageOperation,
          $$PendingMessageOperationsTableFilterComposer,
          $$PendingMessageOperationsTableOrderingComposer,
          $$PendingMessageOperationsTableAnnotationComposer,
          $$PendingMessageOperationsTableCreateCompanionBuilder,
          $$PendingMessageOperationsTableUpdateCompanionBuilder,
          (
            PendingMessageOperation,
            BaseReferences<
              _$AvsLocalDatabase,
              $PendingMessageOperationsTable,
              PendingMessageOperation
            >,
          ),
          PendingMessageOperation,
          PrefetchHooks Function()
        > {
  $$PendingMessageOperationsTableTableManager(
    _$AvsLocalDatabase db,
    $PendingMessageOperationsTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$PendingMessageOperationsTableFilterComposer(
                $db: db,
                $table: table,
              ),
          createOrderingComposer: () =>
              $$PendingMessageOperationsTableOrderingComposer(
                $db: db,
                $table: table,
              ),
          createComputedFieldComposer: () =>
              $$PendingMessageOperationsTableAnnotationComposer(
                $db: db,
                $table: table,
              ),
          updateCompanionCallback:
              ({
                Value<String> id = const Value.absent(),
                Value<String> conversationId = const Value.absent(),
                Value<String> encryptedPayload = const Value.absent(),
                Value<String> state = const Value.absent(),
                Value<DateTime> updatedAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => PendingMessageOperationsCompanion(
                id: id,
                conversationId: conversationId,
                encryptedPayload: encryptedPayload,
                state: state,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String id,
                required String conversationId,
                required String encryptedPayload,
                required String state,
                required DateTime updatedAt,
                Value<int> rowid = const Value.absent(),
              }) => PendingMessageOperationsCompanion.insert(
                id: id,
                conversationId: conversationId,
                encryptedPayload: encryptedPayload,
                state: state,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$PendingMessageOperationsTableProcessedTableManager =
    ProcessedTableManager<
      _$AvsLocalDatabase,
      $PendingMessageOperationsTable,
      PendingMessageOperation,
      $$PendingMessageOperationsTableFilterComposer,
      $$PendingMessageOperationsTableOrderingComposer,
      $$PendingMessageOperationsTableAnnotationComposer,
      $$PendingMessageOperationsTableCreateCompanionBuilder,
      $$PendingMessageOperationsTableUpdateCompanionBuilder,
      (
        PendingMessageOperation,
        BaseReferences<
          _$AvsLocalDatabase,
          $PendingMessageOperationsTable,
          PendingMessageOperation
        >,
      ),
      PendingMessageOperation,
      PrefetchHooks Function()
    >;
typedef $$LocalDraftsTableCreateCompanionBuilder =
    LocalDraftsCompanion Function({
      required String conversationId,
      required String encryptedPayload,
      required DateTime updatedAt,
      Value<int> rowid,
    });
typedef $$LocalDraftsTableUpdateCompanionBuilder =
    LocalDraftsCompanion Function({
      Value<String> conversationId,
      Value<String> encryptedPayload,
      Value<DateTime> updatedAt,
      Value<int> rowid,
    });

class $$LocalDraftsTableFilterComposer
    extends Composer<_$AvsLocalDatabase, $LocalDraftsTable> {
  $$LocalDraftsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get conversationId => $composableBuilder(
    column: $table.conversationId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get encryptedPayload => $composableBuilder(
    column: $table.encryptedPayload,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$LocalDraftsTableOrderingComposer
    extends Composer<_$AvsLocalDatabase, $LocalDraftsTable> {
  $$LocalDraftsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get conversationId => $composableBuilder(
    column: $table.conversationId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get encryptedPayload => $composableBuilder(
    column: $table.encryptedPayload,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$LocalDraftsTableAnnotationComposer
    extends Composer<_$AvsLocalDatabase, $LocalDraftsTable> {
  $$LocalDraftsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get conversationId => $composableBuilder(
    column: $table.conversationId,
    builder: (column) => column,
  );

  GeneratedColumn<String> get encryptedPayload => $composableBuilder(
    column: $table.encryptedPayload,
    builder: (column) => column,
  );

  GeneratedColumn<DateTime> get updatedAt =>
      $composableBuilder(column: $table.updatedAt, builder: (column) => column);
}

class $$LocalDraftsTableTableManager
    extends
        RootTableManager<
          _$AvsLocalDatabase,
          $LocalDraftsTable,
          LocalDraft,
          $$LocalDraftsTableFilterComposer,
          $$LocalDraftsTableOrderingComposer,
          $$LocalDraftsTableAnnotationComposer,
          $$LocalDraftsTableCreateCompanionBuilder,
          $$LocalDraftsTableUpdateCompanionBuilder,
          (
            LocalDraft,
            BaseReferences<_$AvsLocalDatabase, $LocalDraftsTable, LocalDraft>,
          ),
          LocalDraft,
          PrefetchHooks Function()
        > {
  $$LocalDraftsTableTableManager(_$AvsLocalDatabase db, $LocalDraftsTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$LocalDraftsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$LocalDraftsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$LocalDraftsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> conversationId = const Value.absent(),
                Value<String> encryptedPayload = const Value.absent(),
                Value<DateTime> updatedAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => LocalDraftsCompanion(
                conversationId: conversationId,
                encryptedPayload: encryptedPayload,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String conversationId,
                required String encryptedPayload,
                required DateTime updatedAt,
                Value<int> rowid = const Value.absent(),
              }) => LocalDraftsCompanion.insert(
                conversationId: conversationId,
                encryptedPayload: encryptedPayload,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$LocalDraftsTableProcessedTableManager =
    ProcessedTableManager<
      _$AvsLocalDatabase,
      $LocalDraftsTable,
      LocalDraft,
      $$LocalDraftsTableFilterComposer,
      $$LocalDraftsTableOrderingComposer,
      $$LocalDraftsTableAnnotationComposer,
      $$LocalDraftsTableCreateCompanionBuilder,
      $$LocalDraftsTableUpdateCompanionBuilder,
      (
        LocalDraft,
        BaseReferences<_$AvsLocalDatabase, $LocalDraftsTable, LocalDraft>,
      ),
      LocalDraft,
      PrefetchHooks Function()
    >;
typedef $$LocalSyncCursorsTableCreateCompanionBuilder =
    LocalSyncCursorsCompanion Function({
      required String conversationId,
      Value<String?> lastMessageId,
      required DateTime lastSyncedAt,
      Value<int> rowid,
    });
typedef $$LocalSyncCursorsTableUpdateCompanionBuilder =
    LocalSyncCursorsCompanion Function({
      Value<String> conversationId,
      Value<String?> lastMessageId,
      Value<DateTime> lastSyncedAt,
      Value<int> rowid,
    });

class $$LocalSyncCursorsTableFilterComposer
    extends Composer<_$AvsLocalDatabase, $LocalSyncCursorsTable> {
  $$LocalSyncCursorsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get conversationId => $composableBuilder(
    column: $table.conversationId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get lastMessageId => $composableBuilder(
    column: $table.lastMessageId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get lastSyncedAt => $composableBuilder(
    column: $table.lastSyncedAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$LocalSyncCursorsTableOrderingComposer
    extends Composer<_$AvsLocalDatabase, $LocalSyncCursorsTable> {
  $$LocalSyncCursorsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get conversationId => $composableBuilder(
    column: $table.conversationId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get lastMessageId => $composableBuilder(
    column: $table.lastMessageId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get lastSyncedAt => $composableBuilder(
    column: $table.lastSyncedAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$LocalSyncCursorsTableAnnotationComposer
    extends Composer<_$AvsLocalDatabase, $LocalSyncCursorsTable> {
  $$LocalSyncCursorsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get conversationId => $composableBuilder(
    column: $table.conversationId,
    builder: (column) => column,
  );

  GeneratedColumn<String> get lastMessageId => $composableBuilder(
    column: $table.lastMessageId,
    builder: (column) => column,
  );

  GeneratedColumn<DateTime> get lastSyncedAt => $composableBuilder(
    column: $table.lastSyncedAt,
    builder: (column) => column,
  );
}

class $$LocalSyncCursorsTableTableManager
    extends
        RootTableManager<
          _$AvsLocalDatabase,
          $LocalSyncCursorsTable,
          LocalSyncCursor,
          $$LocalSyncCursorsTableFilterComposer,
          $$LocalSyncCursorsTableOrderingComposer,
          $$LocalSyncCursorsTableAnnotationComposer,
          $$LocalSyncCursorsTableCreateCompanionBuilder,
          $$LocalSyncCursorsTableUpdateCompanionBuilder,
          (
            LocalSyncCursor,
            BaseReferences<
              _$AvsLocalDatabase,
              $LocalSyncCursorsTable,
              LocalSyncCursor
            >,
          ),
          LocalSyncCursor,
          PrefetchHooks Function()
        > {
  $$LocalSyncCursorsTableTableManager(
    _$AvsLocalDatabase db,
    $LocalSyncCursorsTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$LocalSyncCursorsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$LocalSyncCursorsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$LocalSyncCursorsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> conversationId = const Value.absent(),
                Value<String?> lastMessageId = const Value.absent(),
                Value<DateTime> lastSyncedAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => LocalSyncCursorsCompanion(
                conversationId: conversationId,
                lastMessageId: lastMessageId,
                lastSyncedAt: lastSyncedAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String conversationId,
                Value<String?> lastMessageId = const Value.absent(),
                required DateTime lastSyncedAt,
                Value<int> rowid = const Value.absent(),
              }) => LocalSyncCursorsCompanion.insert(
                conversationId: conversationId,
                lastMessageId: lastMessageId,
                lastSyncedAt: lastSyncedAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$LocalSyncCursorsTableProcessedTableManager =
    ProcessedTableManager<
      _$AvsLocalDatabase,
      $LocalSyncCursorsTable,
      LocalSyncCursor,
      $$LocalSyncCursorsTableFilterComposer,
      $$LocalSyncCursorsTableOrderingComposer,
      $$LocalSyncCursorsTableAnnotationComposer,
      $$LocalSyncCursorsTableCreateCompanionBuilder,
      $$LocalSyncCursorsTableUpdateCompanionBuilder,
      (
        LocalSyncCursor,
        BaseReferences<
          _$AvsLocalDatabase,
          $LocalSyncCursorsTable,
          LocalSyncCursor
        >,
      ),
      LocalSyncCursor,
      PrefetchHooks Function()
    >;
typedef $$LocalCachePreferencesTableCreateCompanionBuilder =
    LocalCachePreferencesCompanion Function({
      Value<int> id,
      Value<bool> autoDownloadImages,
      Value<bool> autoDownloadDocuments,
      Value<bool> keepOnLogout,
    });
typedef $$LocalCachePreferencesTableUpdateCompanionBuilder =
    LocalCachePreferencesCompanion Function({
      Value<int> id,
      Value<bool> autoDownloadImages,
      Value<bool> autoDownloadDocuments,
      Value<bool> keepOnLogout,
    });

class $$LocalCachePreferencesTableFilterComposer
    extends Composer<_$AvsLocalDatabase, $LocalCachePreferencesTable> {
  $$LocalCachePreferencesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get autoDownloadImages => $composableBuilder(
    column: $table.autoDownloadImages,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get autoDownloadDocuments => $composableBuilder(
    column: $table.autoDownloadDocuments,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get keepOnLogout => $composableBuilder(
    column: $table.keepOnLogout,
    builder: (column) => ColumnFilters(column),
  );
}

class $$LocalCachePreferencesTableOrderingComposer
    extends Composer<_$AvsLocalDatabase, $LocalCachePreferencesTable> {
  $$LocalCachePreferencesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get autoDownloadImages => $composableBuilder(
    column: $table.autoDownloadImages,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get autoDownloadDocuments => $composableBuilder(
    column: $table.autoDownloadDocuments,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get keepOnLogout => $composableBuilder(
    column: $table.keepOnLogout,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$LocalCachePreferencesTableAnnotationComposer
    extends Composer<_$AvsLocalDatabase, $LocalCachePreferencesTable> {
  $$LocalCachePreferencesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<bool> get autoDownloadImages => $composableBuilder(
    column: $table.autoDownloadImages,
    builder: (column) => column,
  );

  GeneratedColumn<bool> get autoDownloadDocuments => $composableBuilder(
    column: $table.autoDownloadDocuments,
    builder: (column) => column,
  );

  GeneratedColumn<bool> get keepOnLogout => $composableBuilder(
    column: $table.keepOnLogout,
    builder: (column) => column,
  );
}

class $$LocalCachePreferencesTableTableManager
    extends
        RootTableManager<
          _$AvsLocalDatabase,
          $LocalCachePreferencesTable,
          LocalCachePreference,
          $$LocalCachePreferencesTableFilterComposer,
          $$LocalCachePreferencesTableOrderingComposer,
          $$LocalCachePreferencesTableAnnotationComposer,
          $$LocalCachePreferencesTableCreateCompanionBuilder,
          $$LocalCachePreferencesTableUpdateCompanionBuilder,
          (
            LocalCachePreference,
            BaseReferences<
              _$AvsLocalDatabase,
              $LocalCachePreferencesTable,
              LocalCachePreference
            >,
          ),
          LocalCachePreference,
          PrefetchHooks Function()
        > {
  $$LocalCachePreferencesTableTableManager(
    _$AvsLocalDatabase db,
    $LocalCachePreferencesTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$LocalCachePreferencesTableFilterComposer(
                $db: db,
                $table: table,
              ),
          createOrderingComposer: () =>
              $$LocalCachePreferencesTableOrderingComposer(
                $db: db,
                $table: table,
              ),
          createComputedFieldComposer: () =>
              $$LocalCachePreferencesTableAnnotationComposer(
                $db: db,
                $table: table,
              ),
          updateCompanionCallback:
              ({
                Value<int> id = const Value.absent(),
                Value<bool> autoDownloadImages = const Value.absent(),
                Value<bool> autoDownloadDocuments = const Value.absent(),
                Value<bool> keepOnLogout = const Value.absent(),
              }) => LocalCachePreferencesCompanion(
                id: id,
                autoDownloadImages: autoDownloadImages,
                autoDownloadDocuments: autoDownloadDocuments,
                keepOnLogout: keepOnLogout,
              ),
          createCompanionCallback:
              ({
                Value<int> id = const Value.absent(),
                Value<bool> autoDownloadImages = const Value.absent(),
                Value<bool> autoDownloadDocuments = const Value.absent(),
                Value<bool> keepOnLogout = const Value.absent(),
              }) => LocalCachePreferencesCompanion.insert(
                id: id,
                autoDownloadImages: autoDownloadImages,
                autoDownloadDocuments: autoDownloadDocuments,
                keepOnLogout: keepOnLogout,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$LocalCachePreferencesTableProcessedTableManager =
    ProcessedTableManager<
      _$AvsLocalDatabase,
      $LocalCachePreferencesTable,
      LocalCachePreference,
      $$LocalCachePreferencesTableFilterComposer,
      $$LocalCachePreferencesTableOrderingComposer,
      $$LocalCachePreferencesTableAnnotationComposer,
      $$LocalCachePreferencesTableCreateCompanionBuilder,
      $$LocalCachePreferencesTableUpdateCompanionBuilder,
      (
        LocalCachePreference,
        BaseReferences<
          _$AvsLocalDatabase,
          $LocalCachePreferencesTable,
          LocalCachePreference
        >,
      ),
      LocalCachePreference,
      PrefetchHooks Function()
    >;
typedef $$LocalAiConversationsTableCreateCompanionBuilder =
    LocalAiConversationsCompanion Function({
      required String id,
      required String encryptedPayload,
      required DateTime updatedAt,
      Value<int> rowid,
    });
typedef $$LocalAiConversationsTableUpdateCompanionBuilder =
    LocalAiConversationsCompanion Function({
      Value<String> id,
      Value<String> encryptedPayload,
      Value<DateTime> updatedAt,
      Value<int> rowid,
    });

class $$LocalAiConversationsTableFilterComposer
    extends Composer<_$AvsLocalDatabase, $LocalAiConversationsTable> {
  $$LocalAiConversationsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get encryptedPayload => $composableBuilder(
    column: $table.encryptedPayload,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$LocalAiConversationsTableOrderingComposer
    extends Composer<_$AvsLocalDatabase, $LocalAiConversationsTable> {
  $$LocalAiConversationsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get encryptedPayload => $composableBuilder(
    column: $table.encryptedPayload,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$LocalAiConversationsTableAnnotationComposer
    extends Composer<_$AvsLocalDatabase, $LocalAiConversationsTable> {
  $$LocalAiConversationsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get encryptedPayload => $composableBuilder(
    column: $table.encryptedPayload,
    builder: (column) => column,
  );

  GeneratedColumn<DateTime> get updatedAt =>
      $composableBuilder(column: $table.updatedAt, builder: (column) => column);
}

class $$LocalAiConversationsTableTableManager
    extends
        RootTableManager<
          _$AvsLocalDatabase,
          $LocalAiConversationsTable,
          LocalAiConversation,
          $$LocalAiConversationsTableFilterComposer,
          $$LocalAiConversationsTableOrderingComposer,
          $$LocalAiConversationsTableAnnotationComposer,
          $$LocalAiConversationsTableCreateCompanionBuilder,
          $$LocalAiConversationsTableUpdateCompanionBuilder,
          (
            LocalAiConversation,
            BaseReferences<
              _$AvsLocalDatabase,
              $LocalAiConversationsTable,
              LocalAiConversation
            >,
          ),
          LocalAiConversation,
          PrefetchHooks Function()
        > {
  $$LocalAiConversationsTableTableManager(
    _$AvsLocalDatabase db,
    $LocalAiConversationsTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$LocalAiConversationsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$LocalAiConversationsTableOrderingComposer(
                $db: db,
                $table: table,
              ),
          createComputedFieldComposer: () =>
              $$LocalAiConversationsTableAnnotationComposer(
                $db: db,
                $table: table,
              ),
          updateCompanionCallback:
              ({
                Value<String> id = const Value.absent(),
                Value<String> encryptedPayload = const Value.absent(),
                Value<DateTime> updatedAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => LocalAiConversationsCompanion(
                id: id,
                encryptedPayload: encryptedPayload,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String id,
                required String encryptedPayload,
                required DateTime updatedAt,
                Value<int> rowid = const Value.absent(),
              }) => LocalAiConversationsCompanion.insert(
                id: id,
                encryptedPayload: encryptedPayload,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$LocalAiConversationsTableProcessedTableManager =
    ProcessedTableManager<
      _$AvsLocalDatabase,
      $LocalAiConversationsTable,
      LocalAiConversation,
      $$LocalAiConversationsTableFilterComposer,
      $$LocalAiConversationsTableOrderingComposer,
      $$LocalAiConversationsTableAnnotationComposer,
      $$LocalAiConversationsTableCreateCompanionBuilder,
      $$LocalAiConversationsTableUpdateCompanionBuilder,
      (
        LocalAiConversation,
        BaseReferences<
          _$AvsLocalDatabase,
          $LocalAiConversationsTable,
          LocalAiConversation
        >,
      ),
      LocalAiConversation,
      PrefetchHooks Function()
    >;
typedef $$LocalAiMessagesTableCreateCompanionBuilder =
    LocalAiMessagesCompanion Function({
      required String id,
      required String conversationId,
      required String encryptedPayload,
      Value<String> state,
      required DateTime createdAt,
      Value<int> rowid,
    });
typedef $$LocalAiMessagesTableUpdateCompanionBuilder =
    LocalAiMessagesCompanion Function({
      Value<String> id,
      Value<String> conversationId,
      Value<String> encryptedPayload,
      Value<String> state,
      Value<DateTime> createdAt,
      Value<int> rowid,
    });

class $$LocalAiMessagesTableFilterComposer
    extends Composer<_$AvsLocalDatabase, $LocalAiMessagesTable> {
  $$LocalAiMessagesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get conversationId => $composableBuilder(
    column: $table.conversationId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get encryptedPayload => $composableBuilder(
    column: $table.encryptedPayload,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get state => $composableBuilder(
    column: $table.state,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$LocalAiMessagesTableOrderingComposer
    extends Composer<_$AvsLocalDatabase, $LocalAiMessagesTable> {
  $$LocalAiMessagesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get conversationId => $composableBuilder(
    column: $table.conversationId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get encryptedPayload => $composableBuilder(
    column: $table.encryptedPayload,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get state => $composableBuilder(
    column: $table.state,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$LocalAiMessagesTableAnnotationComposer
    extends Composer<_$AvsLocalDatabase, $LocalAiMessagesTable> {
  $$LocalAiMessagesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get conversationId => $composableBuilder(
    column: $table.conversationId,
    builder: (column) => column,
  );

  GeneratedColumn<String> get encryptedPayload => $composableBuilder(
    column: $table.encryptedPayload,
    builder: (column) => column,
  );

  GeneratedColumn<String> get state =>
      $composableBuilder(column: $table.state, builder: (column) => column);

  GeneratedColumn<DateTime> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);
}

class $$LocalAiMessagesTableTableManager
    extends
        RootTableManager<
          _$AvsLocalDatabase,
          $LocalAiMessagesTable,
          LocalAiMessage,
          $$LocalAiMessagesTableFilterComposer,
          $$LocalAiMessagesTableOrderingComposer,
          $$LocalAiMessagesTableAnnotationComposer,
          $$LocalAiMessagesTableCreateCompanionBuilder,
          $$LocalAiMessagesTableUpdateCompanionBuilder,
          (
            LocalAiMessage,
            BaseReferences<
              _$AvsLocalDatabase,
              $LocalAiMessagesTable,
              LocalAiMessage
            >,
          ),
          LocalAiMessage,
          PrefetchHooks Function()
        > {
  $$LocalAiMessagesTableTableManager(
    _$AvsLocalDatabase db,
    $LocalAiMessagesTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$LocalAiMessagesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$LocalAiMessagesTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$LocalAiMessagesTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> id = const Value.absent(),
                Value<String> conversationId = const Value.absent(),
                Value<String> encryptedPayload = const Value.absent(),
                Value<String> state = const Value.absent(),
                Value<DateTime> createdAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => LocalAiMessagesCompanion(
                id: id,
                conversationId: conversationId,
                encryptedPayload: encryptedPayload,
                state: state,
                createdAt: createdAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String id,
                required String conversationId,
                required String encryptedPayload,
                Value<String> state = const Value.absent(),
                required DateTime createdAt,
                Value<int> rowid = const Value.absent(),
              }) => LocalAiMessagesCompanion.insert(
                id: id,
                conversationId: conversationId,
                encryptedPayload: encryptedPayload,
                state: state,
                createdAt: createdAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$LocalAiMessagesTableProcessedTableManager =
    ProcessedTableManager<
      _$AvsLocalDatabase,
      $LocalAiMessagesTable,
      LocalAiMessage,
      $$LocalAiMessagesTableFilterComposer,
      $$LocalAiMessagesTableOrderingComposer,
      $$LocalAiMessagesTableAnnotationComposer,
      $$LocalAiMessagesTableCreateCompanionBuilder,
      $$LocalAiMessagesTableUpdateCompanionBuilder,
      (
        LocalAiMessage,
        BaseReferences<
          _$AvsLocalDatabase,
          $LocalAiMessagesTable,
          LocalAiMessage
        >,
      ),
      LocalAiMessage,
      PrefetchHooks Function()
    >;
typedef $$LocalAiDraftsTableCreateCompanionBuilder =
    LocalAiDraftsCompanion Function({
      required String conversationId,
      required String encryptedPayload,
      required DateTime updatedAt,
      Value<int> rowid,
    });
typedef $$LocalAiDraftsTableUpdateCompanionBuilder =
    LocalAiDraftsCompanion Function({
      Value<String> conversationId,
      Value<String> encryptedPayload,
      Value<DateTime> updatedAt,
      Value<int> rowid,
    });

class $$LocalAiDraftsTableFilterComposer
    extends Composer<_$AvsLocalDatabase, $LocalAiDraftsTable> {
  $$LocalAiDraftsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get conversationId => $composableBuilder(
    column: $table.conversationId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get encryptedPayload => $composableBuilder(
    column: $table.encryptedPayload,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$LocalAiDraftsTableOrderingComposer
    extends Composer<_$AvsLocalDatabase, $LocalAiDraftsTable> {
  $$LocalAiDraftsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get conversationId => $composableBuilder(
    column: $table.conversationId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get encryptedPayload => $composableBuilder(
    column: $table.encryptedPayload,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$LocalAiDraftsTableAnnotationComposer
    extends Composer<_$AvsLocalDatabase, $LocalAiDraftsTable> {
  $$LocalAiDraftsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get conversationId => $composableBuilder(
    column: $table.conversationId,
    builder: (column) => column,
  );

  GeneratedColumn<String> get encryptedPayload => $composableBuilder(
    column: $table.encryptedPayload,
    builder: (column) => column,
  );

  GeneratedColumn<DateTime> get updatedAt =>
      $composableBuilder(column: $table.updatedAt, builder: (column) => column);
}

class $$LocalAiDraftsTableTableManager
    extends
        RootTableManager<
          _$AvsLocalDatabase,
          $LocalAiDraftsTable,
          LocalAiDraft,
          $$LocalAiDraftsTableFilterComposer,
          $$LocalAiDraftsTableOrderingComposer,
          $$LocalAiDraftsTableAnnotationComposer,
          $$LocalAiDraftsTableCreateCompanionBuilder,
          $$LocalAiDraftsTableUpdateCompanionBuilder,
          (
            LocalAiDraft,
            BaseReferences<
              _$AvsLocalDatabase,
              $LocalAiDraftsTable,
              LocalAiDraft
            >,
          ),
          LocalAiDraft,
          PrefetchHooks Function()
        > {
  $$LocalAiDraftsTableTableManager(
    _$AvsLocalDatabase db,
    $LocalAiDraftsTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$LocalAiDraftsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$LocalAiDraftsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$LocalAiDraftsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> conversationId = const Value.absent(),
                Value<String> encryptedPayload = const Value.absent(),
                Value<DateTime> updatedAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => LocalAiDraftsCompanion(
                conversationId: conversationId,
                encryptedPayload: encryptedPayload,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String conversationId,
                required String encryptedPayload,
                required DateTime updatedAt,
                Value<int> rowid = const Value.absent(),
              }) => LocalAiDraftsCompanion.insert(
                conversationId: conversationId,
                encryptedPayload: encryptedPayload,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$LocalAiDraftsTableProcessedTableManager =
    ProcessedTableManager<
      _$AvsLocalDatabase,
      $LocalAiDraftsTable,
      LocalAiDraft,
      $$LocalAiDraftsTableFilterComposer,
      $$LocalAiDraftsTableOrderingComposer,
      $$LocalAiDraftsTableAnnotationComposer,
      $$LocalAiDraftsTableCreateCompanionBuilder,
      $$LocalAiDraftsTableUpdateCompanionBuilder,
      (
        LocalAiDraft,
        BaseReferences<_$AvsLocalDatabase, $LocalAiDraftsTable, LocalAiDraft>,
      ),
      LocalAiDraft,
      PrefetchHooks Function()
    >;

class $AvsLocalDatabaseManager {
  final _$AvsLocalDatabase _db;
  $AvsLocalDatabaseManager(this._db);
  $$LocalConversationsTableTableManager get localConversations =>
      $$LocalConversationsTableTableManager(_db, _db.localConversations);
  $$LocalMessagesTableTableManager get localMessages =>
      $$LocalMessagesTableTableManager(_db, _db.localMessages);
  $$PendingMessageOperationsTableTableManager get pendingMessageOperations =>
      $$PendingMessageOperationsTableTableManager(
        _db,
        _db.pendingMessageOperations,
      );
  $$LocalDraftsTableTableManager get localDrafts =>
      $$LocalDraftsTableTableManager(_db, _db.localDrafts);
  $$LocalSyncCursorsTableTableManager get localSyncCursors =>
      $$LocalSyncCursorsTableTableManager(_db, _db.localSyncCursors);
  $$LocalCachePreferencesTableTableManager get localCachePreferences =>
      $$LocalCachePreferencesTableTableManager(_db, _db.localCachePreferences);
  $$LocalAiConversationsTableTableManager get localAiConversations =>
      $$LocalAiConversationsTableTableManager(_db, _db.localAiConversations);
  $$LocalAiMessagesTableTableManager get localAiMessages =>
      $$LocalAiMessagesTableTableManager(_db, _db.localAiMessages);
  $$LocalAiDraftsTableTableManager get localAiDrafts =>
      $$LocalAiDraftsTableTableManager(_db, _db.localAiDrafts);
}
