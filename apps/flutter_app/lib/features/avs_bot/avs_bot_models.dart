class AvsBotConversation {
  const AvsBotConversation({
    required this.id,
    required this.title,
    required this.status,
    required this.updatedAt,
    this.lastMessageAt,
    this.preview,
  });

  final String id;
  final String title;
  final String status;
  final DateTime updatedAt;
  final DateTime? lastMessageAt;
  final String? preview;

  factory AvsBotConversation.fromJson(Map<String, dynamic> json) {
    final messages = json['messages'];
    String? preview;
    if (messages is List && messages.isNotEmpty && messages.first is Map) {
      preview = (messages.first as Map)['content']?.toString();
    }
    return AvsBotConversation(
      id: json['id']?.toString() ?? '',
      title: json['title']?.toString() ?? 'New conversation',
      status: json['status']?.toString() ?? 'ACTIVE',
      updatedAt:
          DateTime.tryParse('${json['updatedAt']}') ?? DateTime.now().toUtc(),
      lastMessageAt: DateTime.tryParse('${json['lastMessageAt']}'),
      preview: preview,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'title': title,
    'status': status,
    'updatedAt': updatedAt.toIso8601String(),
    'lastMessageAt': lastMessageAt?.toIso8601String(),
    if (preview != null)
      'messages': [
        {'content': preview},
      ],
  };
}

class AvsBotSource {
  const AvsBotSource({
    required this.title,
    this.category,
    this.version,
    this.publishedAt,
    this.openRoute,
  });

  final String title;
  final String? category;
  final String? version;
  final DateTime? publishedAt;
  final String? openRoute;

  factory AvsBotSource.fromJson(Map<String, dynamic> json) => AvsBotSource(
    title: json['title']?.toString() ?? 'AVS knowledge',
    category: json['category']?.toString(),
    version: json['version']?.toString(),
    publishedAt: DateTime.tryParse('${json['publishedAt']}'),
    openRoute: json['openRoute']?.toString(),
  );

  Map<String, dynamic> toJson() => {
    'title': title,
    'category': category,
    'version': version,
    'publishedAt': publishedAt?.toIso8601String(),
    'openRoute': openRoute,
  };
}

class AvsBotAction {
  const AvsBotAction({required this.label, required this.route});

  static const allowedRoutes = {
    '/attendance',
    '/learn',
    '/campus',
    '/issues',
    '/feedback',
    '/profile',
    '/announcements',
  };

  final String label;
  final String route;

  bool get isAllowed => allowedRoutes.contains(route);

  factory AvsBotAction.fromJson(Map<String, dynamic> json) => AvsBotAction(
    label: json['label']?.toString() ?? 'Open',
    route: json['route']?.toString() ?? '',
  );

  Map<String, dynamic> toJson() => {
    'label': label,
    'route': route,
    'kind': 'open',
  };
}

class AvsBotMessage {
  const AvsBotMessage({
    required this.id,
    required this.role,
    required this.content,
    required this.status,
    required this.createdAt,
    this.sources = const [],
    this.actions = const [],
    this.feedback,
  });

  final String id;
  final String role;
  final String content;
  final String status;
  final DateTime createdAt;
  final List<AvsBotSource> sources;
  final List<AvsBotAction> actions;
  final String? feedback;

  bool get isAssistant => role == 'ASSISTANT';
  bool get isStreaming => status == 'STREAMING';

  factory AvsBotMessage.fromJson(Map<String, dynamic> json) {
    final feedback = json['feedback'];
    return AvsBotMessage(
      id: json['id']?.toString() ?? '',
      role: json['role']?.toString() ?? 'ASSISTANT',
      content: json['content']?.toString() ?? '',
      status: json['status']?.toString() ?? 'COMPLETED',
      createdAt:
          DateTime.tryParse('${json['createdAt']}') ?? DateTime.now().toUtc(),
      sources: (json['sources'] as List<dynamic>? ?? const [])
          .whereType<Map>()
          .map(
            (value) => AvsBotSource.fromJson(Map<String, dynamic>.from(value)),
          )
          .toList(),
      actions: (json['suggestedActions'] as List<dynamic>? ?? const [])
          .whereType<Map>()
          .map(
            (value) => AvsBotAction.fromJson(Map<String, dynamic>.from(value)),
          )
          .where((value) => value.isAllowed)
          .toList(),
      feedback: feedback is List && feedback.isNotEmpty
          ? (feedback.first as Map)['rating']?.toString()
          : json['feedback']?.toString(),
    );
  }

  AvsBotMessage copyWith({
    String? content,
    String? status,
    List<AvsBotSource>? sources,
    List<AvsBotAction>? actions,
    String? feedback,
  }) => AvsBotMessage(
    id: id,
    role: role,
    content: content ?? this.content,
    status: status ?? this.status,
    createdAt: createdAt,
    sources: sources ?? this.sources,
    actions: actions ?? this.actions,
    feedback: feedback ?? this.feedback,
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'role': role,
    'content': content,
    'status': status,
    'createdAt': createdAt.toIso8601String(),
    'sources': sources.map((source) => source.toJson()).toList(),
    'suggestedActions': actions.map((action) => action.toJson()).toList(),
    if (feedback != null) 'feedback': feedback,
  };
}

class AvsBotStreamEvent {
  const AvsBotStreamEvent(this.type, this.data);

  final String type;
  final Map<String, dynamic> data;
}
