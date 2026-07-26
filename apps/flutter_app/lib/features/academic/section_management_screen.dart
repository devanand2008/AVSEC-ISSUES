import 'package:flutter/material.dart';

import '../../core/network/avs_api_client.dart';

class SectionManagementScreen extends StatefulWidget {
  const SectionManagementScreen({super.key, required this.client});

  final AvsApiClient client;

  @override
  State<SectionManagementScreen> createState() =>
      _SectionManagementScreenState();
}

class _SectionManagementScreenState extends State<SectionManagementScreen> {
  List<Map<String, dynamic>> _sections = [];
  bool _loading = true;
  Object? _error;

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
      final value = await widget.client.get('/academic/admin/sections');
      _sections = (value as List)
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList();
    } catch (error) {
      _error = error;
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _sectionForm(Map<String, dynamic>? existing) async {
    var semesters = <Map<String, dynamic>>[];
    if (existing == null) {
      try {
        final raw = await widget.client.get('/academic/admin/semesters');
        semesters = (raw as List<dynamic>)
            .whereType<Map>()
            .map((value) => Map<String, dynamic>.from(value))
            .toList();
      } catch (error) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Active semesters unavailable: $error')),
          );
        }
        return;
      }
    }
    if (!mounted) return;
    final semester = TextEditingController(
        text: existing?['semesterId']?.toString() ?? '');
    final code =
        TextEditingController(text: existing?['code']?.toString() ?? '');
    final name =
        TextEditingController(text: existing?['name']?.toString() ?? '');
    final year =
        TextEditingController(text: '${existing?['studyYear'] ?? 1}');
    final capacity =
        TextEditingController(text: '${existing?['capacity'] ?? 70}');
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(existing == null ? 'Create section' : 'Edit section'),
        content: SizedBox(
          width: 460,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (existing == null)
                  DropdownButtonFormField<String>(
                    decoration: const InputDecoration(
                      labelText: 'Semester',
                    ),
                    items: semesters
                        .map(
                          (value) => DropdownMenuItem(
                            value: value['id'].toString(),
                            child: Text(
                              '${(value['programme'] as Map?)?['name']} — ${value['name']} (${(value['academicYear'] as Map?)?['name']})',
                            ),
                          ),
                        )
                        .toList(),
                    onChanged: (value) => semester.text = value ?? '',
                  ),
                const SizedBox(height: 10),
                TextField(
                    controller: code,
                    decoration: const InputDecoration(labelText: 'Section code')),
                const SizedBox(height: 10),
                TextField(
                    controller: name,
                    decoration: const InputDecoration(labelText: 'Section name')),
                const SizedBox(height: 10),
                TextField(
                    controller: year,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(labelText: 'Study year')),
                const SizedBox(height: 10),
                TextField(
                  controller: capacity,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'Maximum capacity',
                    helperText: 'The backend maximum is 70 active students.',
                  ),
                ),
              ],
            ),
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
    if (saved == true) {
      final body = {
        if (existing == null) 'semesterId': semester.text.trim(),
        'code': code.text.trim().toUpperCase(),
        'name': name.text.trim(),
        'studyYear': int.tryParse(year.text) ?? 1,
        'capacity': (int.tryParse(capacity.text) ?? 70).clamp(1, 70),
      };
      try {
        existing == null
            ? await widget.client.post('/academic/sections', body)
            : await widget.client
                .patch('/academic/sections/${existing['id']}', body);
        await _load();
      } catch (error) {
        if (mounted) {
          ScaffoldMessenger.of(context)
              .showSnackBar(SnackBar(content: Text('$error')));
        }
      }
    }
    semester.dispose();
    code.dispose();
    name.dispose();
    year.dispose();
    capacity.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Center(
        child: FilledButton(
          onPressed: _load,
          child: Text('Unable to load sections. Retry\n$_error'),
        ),
      );
    }
    return Scaffold(
      body: _sections.isEmpty
          ? const Center(child: Text('No academic sections found.'))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView.builder(
                itemCount: _sections.length,
                itemBuilder: (context, index) {
                  final section = _sections[index];
                  final current = section['currentStudentCount'] ?? 0;
                  final maximum =
                      section['maximumCapacity'] ?? section['capacity'] ?? 70;
                  return Card(
                    margin:
                        const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    child: ListTile(
                      leading: CircleAvatar(child: Text('$current')),
                      title: Text(
                          '${section['name']} (${section['code']})'),
                      subtitle: Text(
                        'Current Students: $current • Maximum Capacity: $maximum'
                        ' • Available Seats: ${section['availableSeats'] ?? 0}\n'
                        '${(section['semester'] as Map?)?['name'] ?? ''}',
                      ),
                      isThreeLine: true,
                      trailing: PopupMenuButton<String>(
                        onSelected: (value) async {
                          if (value == 'edit') {
                            await _sectionForm(section);
                          } else {
                            await Navigator.of(context).push(
                              MaterialPageRoute(
                                builder: (_) => SectionDetailsScreen(
                                  client: widget.client,
                                  section: section,
                                  initialAction: value,
                                ),
                              ),
                            );
                            _load();
                          }
                        },
                        itemBuilder: (_) => const [
                          PopupMenuItem(value: 'details', child: Text('Details')),
                          PopupMenuItem(value: 'edit', child: Text('Edit')),
                          PopupMenuItem(
                              value: 'student', child: Text('Move student here')),
                          PopupMenuItem(
                              value: 'coordinator',
                              child: Text('Assign class coordinator')),
                          PopupMenuItem(
                              value: 'staff',
                              child: Text('Assign prospective staff')),
                          PopupMenuItem(
                              value: 'faculty',
                              child: Text('Assign subject faculty')),
                        ],
                      ),
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => SectionDetailsScreen(
                            client: widget.client,
                            section: section,
                          ),
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _sectionForm(null),
        icon: const Icon(Icons.add),
        label: const Text('Create section'),
      ),
    );
  }
}

class SectionDetailsScreen extends StatefulWidget {
  const SectionDetailsScreen({
    super.key,
    required this.client,
    required this.section,
    this.initialAction,
  });

  final AvsApiClient client;
  final Map<String, dynamic> section;
  final String? initialAction;

  @override
  State<SectionDetailsScreen> createState() => _SectionDetailsScreenState();
}

class _SectionDetailsScreenState extends State<SectionDetailsScreen> {
  Map<String, dynamic>? _details;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load().then((_) {
      if (widget.initialAction != null &&
          widget.initialAction != 'details' &&
          mounted) {
        _assignment(widget.initialAction!);
      }
    });
  }

  Future<void> _load() async {
    try {
      _details = Map<String, dynamic>.from(
        await widget.client
            .get('/academic/sections/${widget.section['id']}') as Map,
      );
    } catch (error) {
      _error = error;
    }
    if (mounted) setState(() {});
  }

  Future<void> _assignment(String type) async {
    final person = TextEditingController();
    final subject = TextEditingController();
    final reason = TextEditingController(text: 'Assigned by Academic Admin');
    var candidates = <Map<String, dynamic>>[];
    var subjects = <Map<String, dynamic>>[];
    try {
      if (type == 'student') {
        final raw = await widget.client
            .get('/admin/people?role=STUDENT&status=ACTIVE&pageSize=100');
        candidates = ((raw as Map)['data'] as List<dynamic>? ?? const [])
            .whereType<Map>()
            .map((value) => Map<String, dynamic>.from(value))
            .toList();
      } else {
        final raw = Map<String, dynamic>.from(
          await widget.client
              .get('/academic/admin/assignments/options') as Map,
        );
        final roleCode =
            type == 'coordinator' ? 'CLASS_COORDINATOR' : 'FACULTY';
        candidates = (raw['users'] as List<dynamic>? ?? const [])
            .whereType<Map>()
            .map((value) => Map<String, dynamic>.from(value))
            .where(
              (value) => (value['roles'] as List<dynamic>? ?? const [])
                  .whereType<Map>()
                  .any(
                    (role) =>
                        (role['role'] as Map?)?['code']?.toString() == roleCode,
                  ),
            )
            .toList();
        if (type == 'faculty') {
          subjects = (raw['subjects'] as List<dynamic>? ?? const [])
              .whereType<Map>()
              .map((value) => Map<String, dynamic>.from(value))
              .where(
                (value) =>
                    value['semesterId']?.toString() ==
                    widget.section['semesterId']?.toString(),
              )
              .toList();
        }
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Assignment options unavailable: $error')),
        );
      }
      person.dispose();
      subject.dispose();
      reason.dispose();
      return;
    }
    if (!mounted) return;
    var attendance = true;
    var resources = false;
    var assessment = false;
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text(type == 'student'
              ? 'Move student to section'
              : type == 'coordinator'
                  ? 'Assign class coordinator'
                  : type == 'staff'
                      ? 'Assign prospective staff'
                      : 'Assign subject faculty'),
          content: SizedBox(
            width: 480,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  DropdownButtonFormField<String>(
                    decoration: InputDecoration(
                      labelText: type == 'student'
                          ? 'Student'
                          : 'Eligible staff member',
                    ),
                    items: candidates
                        .map(
                          (value) => DropdownMenuItem(
                            value: value['publicId'].toString(),
                            child: Text(
                              '${value['fullName']} (${value['collegeIdentityId']})',
                            ),
                          ),
                        )
                        .toList(),
                    onChanged: (value) => person.text = value ?? '',
                  ),
                  if (type == 'faculty') ...[
                    const SizedBox(height: 10),
                    DropdownButtonFormField<String>(
                      decoration: const InputDecoration(labelText: 'Subject'),
                      items: subjects
                          .map(
                            (value) => DropdownMenuItem(
                              value: value['id'].toString(),
                              child: Text(
                                '${value['code']} — ${value['name']}',
                              ),
                            ),
                          )
                          .toList(),
                      onChanged: (value) => subject.text = value ?? '',
                    ),
                    CheckboxListTile(
                      value: attendance,
                      onChanged: (value) => setDialogState(
                          () => attendance = value ?? attendance),
                      title: const Text('Attendance permission'),
                    ),
                    CheckboxListTile(
                      value: resources,
                      onChanged: (value) =>
                          setDialogState(() => resources = value ?? resources),
                      title: const Text('Learning resource permission'),
                    ),
                    CheckboxListTile(
                      value: assessment,
                      onChanged: (value) => setDialogState(
                          () => assessment = value ?? assessment),
                      title: const Text('Assessment permission'),
                    ),
                  ],
                  if (type == 'student') ...[
                    const SizedBox(height: 10),
                    TextField(
                      controller: reason,
                      decoration:
                          const InputDecoration(labelText: 'Move reason'),
                    ),
                  ],
                ],
              ),
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
    if (accepted != true) return;
    final today = DateTime.now().toIso8601String().slice(0, 10);
    try {
      if (type == 'student') {
        await widget.client.post(
          '/academic/sections/${widget.section['id']}/students',
          {
            'studentPublicId': person.text.trim(),
            'startsOn': today,
            'reason': reason.text.trim(),
          },
        );
      } else if (type == 'coordinator') {
        await widget.client.post('/academic/admin/assignments/coordinators', {
          'coordinatorPublicId': person.text.trim(),
          'sectionId': widget.section['id'],
          'validFrom': today,
        });
      } else if (type == 'staff') {
        await widget.client.post('/academic/admin/assignments/class-staff', {
          'staffPublicId': person.text.trim(),
          'sectionId': widget.section['id'],
          'assignmentType': 'PROSPECTIVE_CLASS_STAFF',
          'validFrom': today,
        });
      } else {
        await widget.client.post('/academic/admin/assignments/faculty', {
          'facultyPublicId': person.text.trim(),
          'subjectId': subject.text.trim(),
          'sectionId': widget.section['id'],
          'validFrom': today,
          'assignmentType': 'PRIMARY_FACULTY',
          'attendancePermission': attendance,
          'learningResourcePermission': resources,
          'assessmentPermission': assessment,
        });
      }
      await _load();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$error')));
      }
    }
    person.dispose();
    subject.dispose();
    reason.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('${widget.section['name']}')),
      body: _details == null
          ? Center(
              child: _error == null
                  ? const CircularProgressIndicator()
                  : FilledButton(onPressed: _load, child: Text('Retry: $_error')),
            )
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                Text('${_details!['displayName'] ?? _details!['name']}',
                    style: Theme.of(context).textTheme.headlineSmall),
                const SizedBox(height: 8),
                Text(
                    'Current Students: ${_details!['currentStudentCount']} • Maximum Capacity: ${_details!['maximumCapacity']} • Available Seats: ${_details!['availableSeats']}'),
                if ((_details!['availableSeats'] as num? ?? 0) == 0)
                  const Card(
                    color: Color(0xffffe8e8),
                    child: Padding(
                      padding: EdgeInsets.all(12),
                      child: Text(
                          'This section has reached its maximum capacity of 70 students.'),
                    ),
                  ),
                const Divider(height: 28),
                Text('Active students',
                    style: Theme.of(context).textTheme.titleMedium),
                ...(_details!['memberships'] as List? ?? [])
                    .whereType<Map>()
                    .map((membership) => ListTile(
                          leading: const Icon(Icons.person_outline),
                          title: Text(
                              '${(membership['student'] as Map?)?['fullName']}'),
                          subtitle: Text(
                              '${(membership['student'] as Map?)?['collegeIdentityId']}'),
                        )),
                const Divider(),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    OutlinedButton(
                        onPressed: () => _assignment('student'),
                        child: const Text('Move student')),
                    OutlinedButton(
                        onPressed: () => _assignment('coordinator'),
                        child: const Text('Assign CC')),
                    OutlinedButton(
                        onPressed: () => _assignment('staff'),
                        child: const Text('Assign prospective staff')),
                    FilledButton(
                        onPressed: () => _assignment('faculty'),
                        child: const Text('Assign faculty subject')),
                  ],
                ),
              ],
            ),
    );
  }
}

extension on String {
  String slice(int start, int end) => substring(start, end);
}
