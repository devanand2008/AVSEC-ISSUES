import 'package:flutter/material.dart';

import '../../core/network/avs_api_client.dart';
import 'auth_repository.dart';
import 'auth_user.dart';

String mobileLoginErrorMessage(Object error) {
  if (error is! AvsApiException) {
    return 'An unexpected sign-in error occurred. Close and reopen the app, then try again.';
  }
  String message;
  if (error.statusCode == 0) {
    message = error.message;
  } else if (error.statusCode == 401) {
    message = 'Incorrect college ID, email, password, or college code.';
  } else if (error.statusCode == 403) {
    final reason = error.message.toLowerCase();
    message = reason.contains('suspend')
        ? 'This account is suspended. Contact the college administrator for access.'
        : reason.contains('archiv') || reason.contains('inactive')
        ? 'This account is archived or inactive. Contact the college administrator for access.'
        : 'This account is not permitted to sign in. Contact the college administrator for access.';
  } else if (error.statusCode == 409) {
    message =
        'Your account requires a password or profile action before sign-in can continue. Complete the required action or contact the college administrator.';
  } else if (error.statusCode == 404) {
    message =
        'The sign-in service is unavailable in this app version. Update the app and try again.';
  } else if (error.statusCode == 429) {
    message = 'Too many sign-in attempts. Please wait before trying again.';
  } else if (const {502, 503, 504}.contains(error.statusCode)) {
    message =
        'The AVS server is starting or temporarily unavailable. Please wait a moment and try again.';
  } else if (error.statusCode >= 500) {
    message =
        'The AVS server could not complete sign-in. Please try again shortly.';
  } else {
    message = error.message;
  }
  return error.requestId == null || error.requestId!.isEmpty
      ? message
      : '$message Reference: ${error.requestId}.';
}

class LoginScreen extends StatefulWidget {
  const LoginScreen({
    super.key,
    required this.repository,
    required this.onAuthenticated,
  });

  final AuthRepository repository;
  final ValueChanged<AuthUser> onAuthenticated;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _identifier = TextEditingController();
  final _password = TextEditingController();
  final _collegeCode = TextEditingController();
  bool _busy = false;
  bool _obscure = true;
  String? _error;

  @override
  void dispose() {
    _identifier.dispose();
    _password.dispose();
    _collegeCode.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final user = await widget.repository.login(
        identifier: _identifier.text.trim(),
        password: _password.text,
        collegeCode: _collegeCode.text.trim(),
      );
      widget.onAuthenticated(user);
    } catch (error) {
      if (mounted) {
        setState(() => _error = mobileLoginErrorMessage(error));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Icon(
                      Icons.school,
                      size: 56,
                      color: Theme.of(context).colorScheme.primary,
                    ),
                    const SizedBox(height: 18),
                    Text(
                      'AVS Engineering College',
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.headlineSmall,
                    ),
                    const SizedBox(height: 28),
                    TextFormField(
                      controller: _identifier,
                      keyboardType: TextInputType.emailAddress,
                      autofillHints: const [AutofillHints.username],
                      decoration: const InputDecoration(
                        labelText: 'Official college email',
                        prefixIcon: Icon(Icons.alternate_email),
                      ),
                      validator: (value) =>
                          value == null || value.trim().isEmpty
                          ? 'Enter your official college email.'
                          : null,
                    ),
                    const SizedBox(height: 14),
                    TextFormField(
                      controller: _password,
                      obscureText: _obscure,
                      autofillHints: const [AutofillHints.password],
                      decoration: InputDecoration(
                        labelText: 'AVS password',
                        prefixIcon: const Icon(Icons.lock_outline),
                        suffixIcon: IconButton(
                          tooltip: _obscure ? 'Show password' : 'Hide password',
                          onPressed: () => setState(() => _obscure = !_obscure),
                          icon: Icon(
                            _obscure ? Icons.visibility : Icons.visibility_off,
                          ),
                        ),
                      ),
                      validator: (value) => value == null || value.isEmpty
                          ? 'Enter your AVS password.'
                          : null,
                      onFieldSubmitted: (_) => _submit(),
                    ),
                    const SizedBox(height: 14),
                    TextField(
                      controller: _collegeCode,
                      decoration: const InputDecoration(
                        labelText: 'College code',
                        prefixIcon: Icon(Icons.domain_outlined),
                      ),
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 14),
                      Text(
                        _error!,
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                        ),
                      ),
                    ],
                    const SizedBox(height: 20),
                    FilledButton.icon(
                      onPressed: _busy ? null : _submit,
                      icon: _busy
                          ? const SizedBox.square(
                              dimension: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.login),
                      label: const Text('Sign in'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
