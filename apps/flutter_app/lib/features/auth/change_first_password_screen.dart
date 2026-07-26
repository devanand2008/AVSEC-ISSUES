import 'package:flutter/material.dart';

import '../../core/network/avs_api_client.dart';
import 'auth_repository.dart';
import 'auth_user.dart';

class ChangeFirstPasswordScreen extends StatefulWidget {
  const ChangeFirstPasswordScreen({
    super.key,
    required this.repository,
    required this.onChanged,
  });

  final AuthRepository repository;
  final ValueChanged<AuthUser> onChanged;

  @override
  State<ChangeFirstPasswordScreen> createState() =>
      _ChangeFirstPasswordScreenState();
}

class _ChangeFirstPasswordScreenState
    extends State<ChangeFirstPasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  final _current = TextEditingController();
  final _next = TextEditingController();
  final _confirm = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    _confirm.dispose();
    super.dispose();
  }

  String? _newPasswordError(String? value) {
    final password = value ?? '';
    if (password.length < 10) return 'Use at least 10 characters.';
    if (!RegExp(r'[A-Z]').hasMatch(password)) return 'Add an uppercase letter.';
    if (!RegExp(r'[a-z]').hasMatch(password)) return 'Add a lowercase letter.';
    if (!RegExp(r'\d').hasMatch(password)) return 'Add a number.';
    if (!RegExp(r'[^A-Za-z0-9]').hasMatch(password)) {
      return 'Add a special character.';
    }
    if (password == _current.text) return 'Choose a different password.';
    return null;
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final user = await widget.repository.changeFirstPassword(
        currentPassword: _current.text,
        newPassword: _next.text,
      );
      widget.onChanged(user);
    } on AvsApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Password could not be changed.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Replace temporary password')),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: Form(
              key: _formKey,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextFormField(
                    controller: _current,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: 'Temporary AVS password',
                      prefixIcon: Icon(Icons.key),
                    ),
                    validator: (value) => value == null || value.isEmpty
                        ? 'Enter the temporary password.'
                        : null,
                  ),
                  const SizedBox(height: 14),
                  TextFormField(
                    controller: _next,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: 'New password',
                      prefixIcon: Icon(Icons.lock_reset),
                    ),
                    validator: _newPasswordError,
                  ),
                  const SizedBox(height: 14),
                  TextFormField(
                    controller: _confirm,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: 'Confirm new password',
                      prefixIcon: Icon(Icons.verified_user_outlined),
                    ),
                    validator: (value) => value != _next.text
                        ? 'The confirmation does not match.'
                        : null,
                    onFieldSubmitted: (_) => _submit(),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 14),
                    Text(
                      _error!,
                      style:
                          TextStyle(color: Theme.of(context).colorScheme.error),
                    ),
                  ],
                  const SizedBox(height: 20),
                  FilledButton.icon(
                    onPressed: _busy ? null : _submit,
                    icon: const Icon(Icons.check),
                    label: const Text('Set new password'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
