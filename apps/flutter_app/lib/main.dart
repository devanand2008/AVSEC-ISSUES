import 'package:flutter/material.dart';

import 'core/network/avs_api_client.dart';
import 'core/storage/encrypted_message_cache.dart';
import 'features/auth/auth_repository.dart';
import 'features/auth/auth_user.dart';
import 'features/auth/change_first_password_screen.dart';
import 'features/auth/login_screen.dart';
import 'features/home/app_shell.dart';
import 'features/profile/profile_setup_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const AvsCollegeApp());
}

class AvsCollegeApp extends StatelessWidget {
  const AvsCollegeApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'AVS College',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xff006b5f),
          brightness: Brightness.light,
        ),
        useMaterial3: true,
        inputDecorationTheme: const InputDecorationTheme(
          border: OutlineInputBorder(),
        ),
      ),
      home: const _AuthGate(),
    );
  }
}

class _AuthGate extends StatefulWidget {
  const _AuthGate();

  @override
  State<_AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<_AuthGate> {
  late final AvsApiClient _client;
  late final AuthRepository _repository;
  AuthUser? _user;
  EncryptedMessageCache? _messageCache;
  Object? _messageCacheError;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _client = AvsApiClient();
    _repository = AuthRepository(client: _client);
    _restore();
  }

  Future<void> _restore() async {
    try {
      try {
        _messageCache = await EncryptedMessageCache.open();
      } catch (error) {
        _messageCacheError = error;
      }
      _user = await _repository.restore();
      if (_user != null) {
        await _messageCache?.bindAccount(_user!.id);
      }
    } catch (_) {
      await _client.clearSession();
      _user = null;
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _logout() async {
    final cache = _messageCache;
    if (cache != null) {
      final preferences = await cache.preferences();
      if (!preferences.keepOnLogout) await cache.clear();
    }
    await _repository.logout();
    if (mounted) setState(() => _user = null);
  }

  Future<void> _acceptUser(AuthUser value) async {
    await _messageCache?.bindAccount(value.id);
    if (mounted) setState(() => _user = value);
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    final user = _user;
    if (user == null) {
      return LoginScreen(
        repository: _repository,
        onAuthenticated: _acceptUser,
      );
    }
    if (user.mustChangePassword) {
      return ChangeFirstPasswordScreen(
        repository: _repository,
        onChanged: _acceptUser,
      );
    }
    final isProfileVerificationExempt =
        user.roles.any({'SUPER_ADMIN', 'MAIN_ADMIN'}.contains);
    if (!isProfileVerificationExempt &&
        ['NOT_STARTED', 'IN_PROGRESS', 'REJECTED']
        .contains(user.profileCompletionStatus)) {
      return ProfileSetupScreen(
        client: _client,
        user: user,
        onSubmitted: _acceptUser,
      );
    }
    if (!isProfileVerificationExempt &&
        user.profileCompletionStatus == 'SUBMITTED') {
      return _VerificationPending(
        onRefresh: () async {
          final refreshed = await _repository.restore();
          await _acceptUser(refreshed);
        },
        onLogout: _logout,
      );
    }
    return AvsAppShell(
      user: user,
      client: _client,
      messageCache: _messageCache,
      messageCacheError: _messageCacheError,
      onLogout: _logout,
    );
  }
}

class _VerificationPending extends StatefulWidget {
  const _VerificationPending({
    required this.onRefresh,
    required this.onLogout,
  });

  final Future<void> Function() onRefresh;
  final Future<void> Function() onLogout;

  @override
  State<_VerificationPending> createState() => _VerificationPendingState();
}

class _VerificationPendingState extends State<_VerificationPending> {
  bool _busy = false;

  Future<void> _refresh() async {
    setState(() => _busy = true);
    try {
      await widget.onRefresh();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Profile verification')),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 480),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.verified_user_outlined, size: 64),
                const SizedBox(height: 16),
                Text(
                  'Your profile is awaiting Admin verification.',
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                const SizedBox(height: 10),
                const Text(
                  'Academic or professional details must be verified before the dashboard opens.',
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 20),
                FilledButton.icon(
                  onPressed: _busy ? null : _refresh,
                  icon: _busy
                      ? const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.refresh),
                  label: const Text('Check verification status'),
                ),
                TextButton(
                  onPressed: widget.onLogout,
                  child: const Text('Sign out'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
