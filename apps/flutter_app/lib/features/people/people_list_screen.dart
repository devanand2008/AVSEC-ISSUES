import 'package:flutter/material.dart';

import '../../core/network/avs_api_client.dart';

const _peopleRoles = <String, String?>{
  'All People': null,
  'Students': 'STUDENT',
  'Faculty': 'FACULTY',
  'HOD': 'HOD',
  'Class Coordinators': 'CLASS_COORDINATOR',
  'Principal': 'PRINCIPAL',
  'Vice Principal': 'VICE_PRINCIPAL',
  'Class Representatives': 'CLASS_REPRESENTATIVE',
  'Maintenance Staff': 'MAINTENANCE_STAFF',
  'Administrators': 'MAIN_ADMIN',
  'Archived Users': null,
};

class PeopleListScreen extends StatefulWidget {
  const PeopleListScreen({super.key, required this.client});

  final AvsApiClient client;

  @override
  State<PeopleListScreen> createState() => _PeopleListScreenState();
}

class _PeopleListScreenState extends State<PeopleListScreen> {
  final _search = TextEditingController();
  List<Map<String, dynamic>> _people = [];
  Map<String, dynamic> _meta = {};
  bool _loading = true;
  Object? _error;
  int _page = 1;
  String _tab = 'All People';
  String? _status;
  String? _profileStatus;
  String? _lastLogin;

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

  Future<void> _load({int? page}) async {
    setState(() {
      _loading = true;
      _error = null;
      _page = page ?? _page;
    });
    try {
      final query = <String, String>{
        'page': '$_page',
        'pageSize': '25',
        if (_search.text.trim().isNotEmpty) 'search': _search.text.trim(),
        'role': ?_peopleRoles[_tab],
        'status': ?_status,
        'profileStatus': ?_profileStatus,
        'lastLogin': ?_lastLogin,
        if (_tab == 'Archived Users') 'archived': 'ONLY',
      };
      final value = await widget.client.get(
        '/admin/people?${query.entries.map((entry) => '${entry.key}=${Uri.encodeQueryComponent(entry.value)}').join('&')}',
      ) as Map<String, dynamic>;
      _people = (value['data'] as List? ?? [])
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList();
      _meta = Map<String, dynamic>.from(value['meta'] as Map? ?? {});
    } catch (error) {
      _error = error;
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _role(Map<String, dynamic> person) {
    final roles = (person['roles'] as List? ?? []).whereType<Map>().toList();
    final primary =
        roles.where((role) => role['isPrimary'] == true).firstOrNull ?? roles.firstOrNull;
    return (primary?['role'] as Map?)?['name']?.toString() ?? 'No role';
  }

  String _academic(Map<String, dynamic> person) {
    final student = person['studentProfile'] as Map?;
    final staff = person['staffProfile'] as Map?;
    final department = (student?['department'] as Map?)?['code'] ??
        (staff?['department'] as Map?)?['code'];
    final programme = (student?['programme'] as Map?)?['code'];
    final section = (student?['section'] as Map?)?['code'];
    return [department, programme, section]
        .where((value) => value != null)
        .join(' • ');
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        SizedBox(
          height: 50,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            children: _peopleRoles.keys
                .map(
                  (label) => Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      selected: _tab == label,
                      label: Text(label),
                      onSelected: (_) {
                        setState(() => _tab = label);
                        _load(page: 1);
                      },
                    ),
                  ),
                )
                .toList(),
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(12),
          child: Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              SizedBox(
                width: 300,
                child: TextField(
                  controller: _search,
                  onSubmitted: (_) => _load(page: 1),
                  decoration: InputDecoration(
                    labelText: 'Name, email, ID, register, mobile',
                    prefixIcon: const Icon(Icons.search),
                    suffixIcon: IconButton(
                      onPressed: () => _load(page: 1),
                      icon: const Icon(Icons.arrow_forward),
                    ),
                  ),
                ),
              ),
              _filter(
                value: _status,
                hint: 'Account status',
                values: const ['ACTIVE', 'SUSPENDED', 'PENDING', 'ARCHIVED'],
                onChanged: (value) {
                  setState(() => _status = value);
                  _load(page: 1);
                },
              ),
              _filter(
                value: _profileStatus,
                hint: 'Profile status',
                values: const [
                  'NOT_STARTED',
                  'IN_PROGRESS',
                  'SUBMITTED',
                  'VERIFIED',
                  'REJECTED',
                ],
                onChanged: (value) {
                  setState(() => _profileStatus = value);
                  _load(page: 1);
                },
              ),
              _filter(
                value: _lastLogin,
                hint: 'Last login',
                values: const ['LAST_7_DAYS', 'LAST_30_DAYS', 'NEVER'],
                onChanged: (value) {
                  setState(() => _lastLogin = value);
                  _load(page: 1);
                },
              ),
            ],
          ),
        ),
        Expanded(child: _body()),
        if (!_loading)
          Padding(
            padding: const EdgeInsets.all(8),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                IconButton(
                  onPressed: _page > 1 ? () => _load(page: _page - 1) : null,
                  icon: const Icon(Icons.chevron_left),
                ),
                Text(
                    'Page $_page of ${_meta['pageCount'] ?? 1} • ${_meta['total'] ?? 0} people'),
                IconButton(
                  onPressed: _page < (_meta['pageCount'] as num? ?? 1)
                      ? () => _load(page: _page + 1)
                      : null,
                  icon: const Icon(Icons.chevron_right),
                ),
              ],
            ),
          ),
      ],
    );
  }

  Widget _filter({
    required String? value,
    required String hint,
    required List<String> values,
    required ValueChanged<String?> onChanged,
  }) {
    return SizedBox(
      width: 190,
      child: DropdownButtonFormField<String>(
        initialValue: value,
        decoration: InputDecoration(labelText: hint),
        items: [
          const DropdownMenuItem(value: null, child: Text('All')),
          ...values.map((item) => DropdownMenuItem(
                value: item,
                child: Text(item.replaceAll('_', ' ')),
              )),
        ],
        onChanged: onChanged,
      ),
    );
  }

  Widget _body() {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Unable to load people.\n$_error', textAlign: TextAlign.center),
            const SizedBox(height: 10),
            FilledButton(onPressed: _load, child: const Text('Retry')),
          ],
        ),
      );
    }
    if (_people.isEmpty) {
      return const Center(child: Text('No people match the selected filters.'));
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        itemCount: _people.length,
        separatorBuilder: (_, _) => const Divider(height: 1),
        itemBuilder: (context, index) {
          final person = _people[index];
          final name = person['fullName']?.toString() ?? 'Unknown';
          return ListTile(
            leading: CircleAvatar(child: Text(name.isEmpty ? '?' : name[0])),
            title: Text(name),
            subtitle: Text(
              '${person['email'] ?? person['collegeIdentityId']} • ${_role(person)}'
              '${_academic(person).isEmpty ? '' : '\n${_academic(person)}'}'
              '\n${person['status']} • ${person['profileCompletionStatus']}'
              '${person['assignedPlaceLabel'] == null ? '' : ' • ${person['assignedPlaceLabel']}'}',
            ),
            isThreeLine: true,
            trailing: const Icon(Icons.chevron_right),
            onTap: () async {
              await Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => PersonDetailsScreen(
                    client: widget.client,
                    publicId: person['publicId'].toString(),
                  ),
                ),
              );
              _load();
            },
          );
        },
      ),
    );
  }
}

class PersonDetailsScreen extends StatefulWidget {
  const PersonDetailsScreen({
    super.key,
    required this.client,
    required this.publicId,
  });

  final AvsApiClient client;
  final String publicId;

  @override
  State<PersonDetailsScreen> createState() => _PersonDetailsScreenState();
}

class _PersonDetailsScreenState extends State<PersonDetailsScreen> {
  Map<String, dynamic>? _person;
  Object? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      _person = Map<String, dynamic>.from(
        await widget.client.get('/admin/people/${widget.publicId}') as Map,
      );
    } catch (error) {
      _error = error;
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _reasonAction(String action) async {
    final controller = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(action.replaceAll('-', ' ')),
        content: TextField(
          controller: controller,
          maxLines: 3,
          decoration: const InputDecoration(labelText: 'Reason'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Confirm'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (reason == null || reason.length < 3) return;
    try {
      await widget.client.post(
        '/admin/people/${widget.publicId}/$action',
        {'reason': reason},
      );
      await _load();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$error')));
      }
    }
  }

  Future<void> _edit() async {
    final person = _person!;
    final name = TextEditingController(text: person['fullName']?.toString());
    final email = TextEditingController(text: person['email']?.toString());
    final mobile = TextEditingController(text: person['mobile']?.toString());
    final save = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Edit person'),
        content: SizedBox(
          width: 440,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                  controller: name,
                  decoration: const InputDecoration(labelText: 'Full name')),
              const SizedBox(height: 10),
              TextField(
                  controller: email,
                  decoration:
                      const InputDecoration(labelText: 'Official email')),
              const SizedBox(height: 10),
              TextField(
                  controller: mobile,
                  decoration: const InputDecoration(labelText: 'Mobile')),
            ],
          ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Save')),
        ],
      ),
    );
    if (save == true) {
      await widget.client.patch('/admin/people/${widget.publicId}', {
        'fullName': name.text.trim(),
        'email': email.text.trim(),
        'mobile': mobile.text.trim(),
      });
      await _load();
    }
    name.dispose();
    email.dispose();
    mobile.dispose();
  }

  Future<void> _assignPlace() async {
    final placeId = TextEditingController();
    final reason = TextEditingController();
    final types = ['CAMPUS', 'BLOCK', 'FLOOR', 'ROOM'];
    late final Map<String, List<Map<String, dynamic>>> places;
    try {
      final values = await Future.wait(
        ['campuses', 'blocks', 'floors', 'rooms'].map(
          (path) => widget.client.get('/admin/$path?status=ACTIVE'),
        ),
      );
      places = {
        for (var index = 0; index < types.length; index++)
          types[index]: (values[index] as List<dynamic>)
              .whereType<Map>()
              .map((value) => Map<String, dynamic>.from(value))
              .toList(),
      };
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Campus places could not be loaded: $error')),
        );
      }
      placeId.dispose();
      reason.dispose();
      return;
    }
    if (!mounted) return;
    var type = 'ROOM';
    final save = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('Assign place'),
          content: SizedBox(
            width: 440,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<String>(
                  initialValue: type,
                  items: types
                      .map((value) =>
                          DropdownMenuItem(value: value, child: Text(value)))
                      .toList(),
                  onChanged: (value) => setDialogState(() {
                    type = value ?? type;
                    placeId.clear();
                  }),
                  decoration: const InputDecoration(labelText: 'Place type'),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  key: ValueKey(type),
                  decoration: const InputDecoration(labelText: 'Campus place'),
                  items: (places[type] ?? const [])
                      .map(
                        (value) => DropdownMenuItem(
                          value: value['id'].toString(),
                          child: Text(
                            '${value['name']} (${value['code']})',
                          ),
                        ),
                      )
                      .toList(),
                  onChanged: (value) => placeId.text = value ?? '',
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: reason,
                  decoration: const InputDecoration(labelText: 'Reason'),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: const Text('Cancel')),
            FilledButton(
                onPressed: () => Navigator.pop(context, true),
                child: const Text('Assign')),
          ],
        ),
      ),
    );
    if (save == true) {
      final roles = (_person!['roles'] as List? ?? [])
          .whereType<Map>()
          .map((row) => (row['role'] as Map?)?['code']?.toString())
          .whereType<String>()
          .toList();
      final scopes = (_person!['scopes'] as List? ?? [])
          .whereType<Map>()
          .map((row) => {
                'type': row['scopeType'],
                if (row['scopeId'] != null) 'id': row['scopeId'],
                if (row['issueCategoryId'] != null)
                  'issueCategoryId': row['issueCategoryId'],
              })
          .where((row) => row['type'] != type)
          .toList()
        ..add({'type': type, 'id': placeId.text.trim()});
      await widget.client.patch('/users/${widget.publicId}/access', {
        'roleCodes': roles,
        'scopes': scopes,
        'reason': reason.text.trim(),
      });
      await _load();
    }
    placeId.dispose();
    reason.dispose();
  }

  Future<void> _safeDelete() async {
    try {
      final report = Map<String, dynamic>.from(
        await widget.client
            .get('/admin/people/${widget.publicId}/dependencies') as Map,
      );
      if (!mounted) return;
      final counts = Map<String, dynamic>.from(
        report['counts'] as Map? ?? const {},
      );
      final phrase = TextEditingController();
      final backup = TextEditingController();
      final reason = TextEditingController();
      final canDelete = report['canDelete'] == true;
      final approved = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Safe permanent delete'),
          content: SizedBox(
            width: 480,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(report['message']?.toString() ?? ''),
                  const SizedBox(height: 12),
                  for (final entry
                      in counts.entries.where((entry) => entry.value != 0))
                    Text('${entry.key}: ${entry.value}'),
                  if (canDelete) ...[
                    const SizedBox(height: 16),
                    TextField(
                      controller: backup,
                      decoration: const InputDecoration(
                        labelText: 'Verified backup reference',
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: reason,
                      decoration:
                          const InputDecoration(labelText: 'Deletion reason'),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: phrase,
                      decoration: const InputDecoration(
                        labelText: 'Type PERMANENTLY DELETE USER',
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            if (canDelete)
              FilledButton(
                onPressed: () => Navigator.pop(context, true),
                child: const Text('Delete permanently'),
              ),
          ],
        ),
      );
      final body = {
        'backupReference': backup.text.trim(),
        'reason': reason.text.trim(),
        'confirmationPhrase': phrase.text.trim(),
      };
      phrase.dispose();
      backup.dispose();
      reason.dispose();
      if (approved != true) return;
      await widget.client.delete(
        '/admin/people/${widget.publicId}',
        body,
      );
      if (mounted) Navigator.of(context).pop();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$error')));
      }
    }
  }

  Future<void> _verifyProfile() async {
    try {
      await widget.client.post(
        '/admin/users/${widget.publicId}/verify-profile',
        const {},
      );
      await _load();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$error')));
      }
    }
  }

  Future<void> _rejectProfile() async {
    final reason = await _textInput(
      title: 'Reject profile submission',
      label: 'Correction required',
    );
    if (reason == null || reason.length < 3) return;
    try {
      await widget.client.post(
        '/admin/users/${widget.publicId}/reject-profile',
        {'reason': reason},
      );
      await _load();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$error')));
      }
    }
  }

  Future<String?> _textInput({
    required String title,
    required String label,
  }) async {
    final controller = TextEditingController();
    final value = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: TextField(
          controller: controller,
          maxLines: 3,
          decoration: InputDecoration(labelText: label),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Confirm'),
          ),
        ],
      ),
    );
    controller.dispose();
    return value;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Person details')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: FilledButton(
                    onPressed: _load,
                    child: Text('Retry: $_error'),
                  ),
                )
              : _content(),
    );
  }

  Widget _content() {
    final person = _person!;
    final roles = (person['roles'] as List? ?? [])
        .whereType<Map>()
        .map((row) => (row['role'] as Map?)?['name'])
        .join(', ');
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        CircleAvatar(
          radius: 38,
          child: Text('${person['fullName']}'.characters.firstOrNull ?? '?'),
        ),
        const SizedBox(height: 12),
        Text('${person['fullName']}',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.headlineSmall),
        Text('${person['email'] ?? person['collegeIdentityId']}',
            textAlign: TextAlign.center),
        const SizedBox(height: 18),
        _line('Roles', roles),
        _line('Status', '${person['status']}'),
        _line('Profile', '${person['profileCompletionStatus']}'),
        _line('Mobile', '${person['mobile'] ?? 'Not provided'}'),
        _line('Last login', '${person['lastLoginAt'] ?? 'Never'}'),
        const Divider(),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            FilledButton.tonalIcon(
                onPressed: _edit,
                icon: const Icon(Icons.edit),
                label: const Text('Edit')),
            FilledButton.tonalIcon(
                onPressed: _assignPlace,
                icon: const Icon(Icons.place_outlined),
                label: const Text('Assign place')),
            FilledButton.tonalIcon(
                onPressed: () => _reasonAction('revoke-sessions'),
                icon: const Icon(Icons.phonelink_erase),
                label: const Text('Revoke sessions')),
            FilledButton.tonalIcon(
                onPressed: () => _reasonAction(
                    person['status'] == 'ARCHIVED' ? 'restore' : 'archive'),
                icon: Icon(person['status'] == 'ARCHIVED'
                    ? Icons.restore
                    : Icons.archive_outlined),
                label: Text(
                    person['status'] == 'ARCHIVED' ? 'Restore' : 'Archive')),
            if (person['profileCompletionStatus'] == 'SUBMITTED')
              FilledButton.icon(
                onPressed: _verifyProfile,
                icon: const Icon(Icons.verified_outlined),
                label: const Text('Verify profile'),
              ),
            if (person['profileCompletionStatus'] == 'SUBMITTED')
              OutlinedButton.icon(
                onPressed: _rejectProfile,
                icon: const Icon(Icons.feedback_outlined),
                label: const Text('Request correction'),
              ),
            if (person['status'] == 'ARCHIVED')
              FilledButton.tonalIcon(
                onPressed: _safeDelete,
                icon: const Icon(Icons.delete_forever_outlined),
                label: const Text('Safe permanent delete'),
              ),
          ],
        ),
        const SizedBox(height: 14),
        const Text(
          'Permanent deletion remains intentionally separate and requires a dependency report, verified backup reference, Main Admin permission, and the exact confirmation phrase.',
        ),
      ],
    );
  }

  Widget _line(String label, String value) => ListTile(
        title: Text(label),
        trailing: Flexible(child: Text(value, textAlign: TextAlign.end)),
      );
}
