class AuthUser {
  const AuthUser({
    required this.id,
    required this.fullName,
    required this.mustChangePassword,
    required this.profileCompletionStatus,
    required this.roles,
    required this.permissions,
    this.email,
  });

  final String id;
  final String fullName;
  final String? email;
  final bool mustChangePassword;
  final String profileCompletionStatus;
  final List<String> roles;
  final List<String> permissions;

  factory AuthUser.fromJson(Map<String, dynamic> json) {
    return AuthUser(
      id: json['id'] as String? ?? '',
      fullName: json['fullName'] as String? ?? 'AVS User',
      email: json['email'] as String?,
      mustChangePassword: json['mustChangePassword'] as bool? ?? false,
      profileCompletionStatus:
          json['profileCompletionStatus'] as String? ?? 'NOT_STARTED',
      roles: (json['roles'] as List<dynamic>? ?? const [])
          .map((value) => value is String
              ? value
              : value is Map<String, dynamic>
                  ? (value['code'] as String? ?? '')
                  : '')
          .where((value) => value.isNotEmpty)
          .toList(),
      permissions: (json['permissions'] as List<dynamic>? ?? const [])
          .whereType<String>()
          .toList(),
    );
  }
}
