const express = require('express');
const sql = require('mssql');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Database Configuration
const dbConfig = {
    user: 'MedcareAdmin',
    password: 'Admin123',
    server: 'localhost\\SQLEXPRESS01',  // or 'localhost\\SQLEXPRESS' for SQL Express
    database: 'Medcare',
    options: {
        encrypt: true,
        trustServerCertificate: true
    }
};
let pool;

// Initialize Database Connection
async function initializeDatabase() {
    try {
        pool = await sql.connect(dbConfig);
        console.log('Database connected successfully');
    } catch (err) {
        console.error('Database connection failed:', err);
        process.exit(1);
    } 
}

// ============================================
// AUTHENTICATION ROUTES
// ============================================

// SIGN UP - Patient Only (Self Registration)
app.post('/api/auth/signup', async (req, res) => {
    try {
        const { first_name, last_name, age, gender, blood_group, phone_no, password } = req.body;

        if (!first_name || !last_name || !age || !gender || !password) {
            return res.status(400).json({ error: "All required fields must be provided" });
        }

        const result = await pool.request()
            .input('first_name', sql.VarChar, first_name)
            .input('last_name', sql.VarChar, last_name)
            .input('age', sql.Int, age)
            .input('gender', sql.VarChar, gender)
            .input('blood_group', sql.VarChar, blood_group || null)
            .input('phone_no', sql.VarChar, phone_no || null)
            .input('password', sql.VarChar, password)
            .query(`
                INSERT INTO patients (password, first_name, last_name, age, gender, blood_group, phone_no)
                OUTPUT INSERTED.patient_id, INSERTED.patient_login_id, INSERTED.first_name, INSERTED.last_name
                VALUES (@password, @first_name, @last_name, @age, @gender, @blood_group, @phone_no)
            `);

        const patient = result.recordset[0];

        await pool.request()
            .input('patient_id', sql.Int, patient.patient_id)
            .input('first_name', sql.VarChar, patient.first_name)
            .input('last_name', sql.VarChar, patient.last_name)
            .query(`
                INSERT INTO signup_logs (patient_id, first_name, last_name)
                VALUES (@patient_id, @first_name, @last_name)
            `);

        return res.status(201).json({
            message: "Patient registered successfully",
            patient_login_id: patient.patient_login_id,
            patient_id: patient.patient_id,
            first_name: patient.first_name,
            last_name: patient.last_name
        });

    } catch (err) {
        console.error("Signup error:", err);
        return res.status(500).json({ error: "Server error during signup" });
    }
});


// SIGN IN - Auto-detect user type from ID prefix
app.post('/api/auth/signin', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: "Username and password are required" });
        }

        const loginId = username.trim().toUpperCase();
        let user_type = null;
        let query = null;

        // Auto-detect user type by ID prefix
        const prefix = loginId.charAt(0);
        if (prefix === "A") {
            user_type = "admin";
            query = `
                SELECT admin_id AS user_id, admin_login_id, username AS name, password
                FROM admin
                WHERE admin_login_id = @u OR username = @u
            `;
        } else if (prefix === "D") {
            user_type = "doctor";
            query = `
                SELECT doctor_id AS user_id, doctor_login_id, first_name, last_name, password,
                    specialization_id, consultation_fee, phone_no, experience_years,
                    registration_number, roomNo, age
                FROM doctors
                WHERE doctor_login_id = @u
            `;
        } else if (prefix === "P") {
            user_type = "patient";
            query = `
                SELECT patient_id AS user_id, patient_login_id, first_name, last_name, 
                       password, age, gender, blood_group, phone_no
                FROM patients
                WHERE patient_login_id = @u
            `;
        } else if (prefix === "R") {
            user_type = "receptionist";
            query = `
                SELECT receptionist_id AS user_id, receptionist_login_id, first_name,
                       last_name, password, contact_no
                FROM receptionists
                WHERE receptionist_login_id = @u
            `;
        } else {
            return res.status(400).json({
                error: "Invalid login ID. Must start with A, D, P, or R."
            });
        }

        // Execute the detected query
        const result = await pool.request()
            .input("u", sql.VarChar, loginId)
            .query(query);

        if (result.recordset.length === 0) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        const user = result.recordset[0];

        // Password check
        if (password !== user.password) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        // Log signin with user_id and user_type
        await logSignin(user.user_id, user_type);

        delete user.password;

        return res.json({
            message: "Sign in successful",
            user_type,
            user
        });

    } catch (err) {
        console.error("Signin error:", err);
        return res.status(500).json({ error: "Server error during signin" });
    }
});

// logSignin stores user_id and user_type
async function logSignin(user_id, user_type) {
    try {
        await pool.request()
            .input("user_id", sql.VarChar, String(user_id))
            .input("user_type", sql.VarChar, user_type)
            .query(`
                INSERT INTO signin_logs (user_id, user_type)
                VALUES (@user_id, @user_type)
            `);
    } catch (err) {
        console.error("Signin logging error:", err);
    }
}

// ============================================
// SPECIALIZATION ROUTES
// ============================================

// GET ALL SPECIALIZATIONS
app.get('/api/specializations', async (req, res) => {
    try {
        const result = await pool.request().query(`
            SELECT * FROM specializations
            ORDER BY specialization_name
        `);
        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching specializations:', err);
        res.status(500).json({ error: 'Error fetching specializations' });
    }
});

// GET SPECIALIZATION BY ID
app.get('/api/specializations/:id', async (req, res) => {
    try {
        const specializationId = parseInt(req.params.id, 10);
        const result = await pool.request()
            .input('specialization_id', sql.Int, specializationId)
            .query('SELECT * FROM specializations WHERE specialization_id = @specialization_id');

        if (result.recordset.length === 0) {
            return res.status(404).json({ error: 'Specialization not found' });
        }
        res.json(result.recordset[0]);
    } catch (err) {
        console.error('Error fetching specialization:', err);
        res.status(500).json({ error: 'Error fetching specialization' });
    }
});


// ADD DOCTOR - roomNo auto-generated from sequence
app.post('/api/doctors', async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      age,
      password,
      specialization_id,
      consultation_fee,
      phone_no,
      experience_years,
      registration_number
    } = req.body;

    // Validate required fields
    if (!first_name || !last_name || !age || !password || !specialization_id || !experience_years) {
      return res.status(400).json({
        error: "Missing required fields: first_name, last_name, age, password, specialization_id, experience_years"
      });
    }

    const result = await pool.request()
      .input("first_name", sql.VarChar, first_name)
      .input("last_name", sql.VarChar, last_name)
      .input("age", sql.Int, age)
      .input("password", sql.VarChar, password)
      .input("specialization_id", sql.Int, specialization_id)
      .input("consultation_fee", sql.Decimal(10, 2), consultation_fee || 0)
      .input("phone_no", sql.VarChar, phone_no || null)
      .input("experience_years", sql.Int, experience_years)
      .input("registration_number", sql.VarChar, registration_number || null)
      .query(`
        INSERT INTO doctors (
          first_name, last_name, age, password,
          specialization_id, consultation_fee,
          phone_no, experience_years, registration_number, roomNo
        )
        OUTPUT INSERTED.*
        VALUES (
          @first_name, @last_name, @age, @password,
          @specialization_id, @consultation_fee,
          @phone_no, @experience_years, @registration_number,
          NEXT VALUE FOR RoomNo_Seq
        )
      `);

    const doctor = result.recordset[0];
    delete doctor.password; // Remove password for security

    res.status(201).json({
      message: "Doctor added successfully",
      doctor: doctor
    });

  } catch (err) {
    console.error("Error adding doctor:", err);

    if (err.number === 2627) {
      return res.status(409).json({ error: "Registration number already exists" });
    }
    if (err.number === 547) {
      return res.status(400).json({ error: "Invalid specialization_id" });
    }

    res.status(500).json({ error: "Error adding doctor: " + err.message });
  }
});

// GET ALL DOCTORS
app.get('/api/doctors', async (req, res) => {
    try {
        const result = await pool.request().query(`
            SELECT 
                d.doctor_id,
                d.doctor_login_id,
                d.first_name,
                d.last_name,
                d.age,
                d.specialization_id,
                d.consultation_fee,
                d.phone_no,
                d.experience_years,
                d.registration_number,
                d.roomNo,
                s.specialization_name
            FROM doctors d
            INNER JOIN specializations s ON d.specialization_id = s.specialization_id
            ORDER BY d.doctor_id DESC
        `);

        res.json(result.recordset);

    } catch (err) {
        console.error('Error fetching doctors:', err);
        res.status(500).json({ error: 'Error fetching doctors: ' + err.message });
    }
});

// GET DOCTOR BY ID
app.get('/api/doctors/:id', async (req, res) => {
    try {
        const doctorId = parseInt(req.params.id, 10);

        const result = await pool.request()
            .input('doctor_id', sql.Int, doctorId)
            .query(`
                SELECT d.*, s.specialization_name
                FROM doctors d
                INNER JOIN specializations s ON d.specialization_id = s.specialization_id
                WHERE d.doctor_id = @doctor_id
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({ error: 'Doctor not found' });
        }

        const doctor = result.recordset[0];
        delete doctor.password;

        res.json(doctor);

    } catch (err) {
        console.error('Error fetching doctor:', err);
        res.status(500).json({ error: 'Error fetching doctor' });
    }
});


// DELETE (REMOVE) DOCTOR
app.delete('/api/doctors/:id', async (req, res) => {
    const transaction = new sql.Transaction(pool);

    try {
        const doctorId = parseInt(req.params.id, 10);
        const { removal_reason, removed_by_admin_id } = req.body;

        if (!removal_reason || !removed_by_admin_id) {
            return res.status(400).json({ error: 'removal_reason and removed_by_admin_id are required' });
        }

        await transaction.begin();

        const trRequest = new sql.Request(transaction);

        const doctorRes = await trRequest
            .input('doctor_id', sql.Int, doctorId)
            .query(`
                SELECT doctor_id,
                       CONCAT(first_name, ' ', last_name) AS doctor_name,
                       specialization_id,
                       registration_number
                FROM doctors 
                WHERE doctor_id = @doctor_id
            `);

        if (doctorRes.recordset.length === 0) {
            await transaction.rollback();
            return res.status(404).json({ error: 'Doctor not found' });
        }

        const doc = doctorRes.recordset[0];

        await trRequest
            .input('doctor_id', sql.Int, doctorId)
            .input('doctor_name', sql.VarChar, doc.doctor_name)
            .input('specialization_id', sql.Int, doc.specialization_id)
            .input('registration_number', sql.VarChar, doc.registration_number || null)
            .input('removal_reason', sql.VarChar, removal_reason)
            .input('removed_by_admin_id', sql.Int, removed_by_admin_id)
            .query(`
                INSERT INTO removed_doctors (
                    doctor_id, doctor_name, specialization_id,
                    registration_number, removal_reason, removed_by_admin_id
                )
                VALUES (@doctor_id, @doctor_name, @specialization_id,
                        @registration_number, @removal_reason, @removed_by_admin_id)
            `);

        await trRequest.query(`DELETE FROM doctors WHERE doctor_id = @doctor_id`);

        await transaction.commit();
        res.json({ message: 'Doctor removed and recorded in removed_doctors' });

    } catch (err) {
        try { await transaction.rollback(); } catch { }
        console.error('Error removing doctor:', err);
        res.status(500).json({ error: 'Error removing doctor' });
    }
});



// GET REMOVED DOCTORS
app.get('/api/removed-doctors', async (req, res) => {
    try {
        const result = await pool.request().query(`
            SELECT rd.*, a.username AS removed_by_admin, s.specialization_name
            FROM removed_doctors rd
            LEFT JOIN admin a ON rd.removed_by_admin_id = a.admin_id
            LEFT JOIN specializations s ON rd.specialization_id = s.specialization_id
            ORDER BY rd.removal_date DESC
        `);

        res.json(result.recordset);

    } catch (err) {
        console.error('Error fetching removed doctors:', err);
        res.status(500).json({ error: 'Error fetching removed doctors' });
    }
});

// ============================================
// TIME SLOTS ROUTES
// ============================================

app.get('/api/time-slots', async (req, res) => {
    try {
        const result = await pool.request().query('SELECT * FROM time_slots ORDER BY slot_number');
        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching time_slots:', err);
        res.status(500).json({ error: 'Error fetching time slots' });
    }
});

// ============================================
// DOCTOR SCHEDULES ROUTES (UPDATED)
// ============================================

// Add schedule of doctor
app.post('/api/doctors/:doctorId/schedules', async (req, res) => {
    try {
        const doctorId = parseInt(req.params.doctorId, 10);
        const { day_of_week, slot_id, is_active } = req.body;

        if (day_of_week === undefined || !slot_id) {
            return res.status(400).json({ error: 'day_of_week and slot_id are required' });
        }

        const result = await pool.request()
            .input('doctor_id', sql.Int, doctorId)
            .input('day_of_week', sql.TinyInt, day_of_week)
            .input('slot_id', sql.Int, slot_id)
            .input('is_active', sql.Bit, is_active === undefined ? 1 : is_active)
            .query(`
                INSERT INTO doctor_schedules (doctor_id, day_of_week, slot_id, is_active)
                OUTPUT INSERTED.*
                VALUES (@doctor_id, @day_of_week, @slot_id, @is_active)
            `);

        res.status(201).json({ message: 'Schedule created', schedule: result.recordset[0] });

    } catch (err) {
        console.error('Error creating schedule:', err);
        if (err && err.number === 2627) {
            return res.status(409).json({ error: 'Schedule for this doctor/day/slot already exists' });
        }
        res.status(500).json({ error: 'Error creating schedule' });
    }
});

// Get schedules with time slot details
app.get('/api/schedules', async (req, res) => {
    try {
        const { doctor_id, day_of_week } = req.query;
        let query = `
            SELECT 
                ds.schedule_id,
                ds.doctor_id,
                ds.day_of_week,
                ds.slot_id,
                ds.is_active,
                ds.created_at,
                ds.updated_at,
                ts.slot_number,
                ts.start_time,
                ts.end_time,
                CONCAT(d.first_name, ' ', d.last_name) AS doctor_name,
                d.doctor_login_id,
                d.RoomNo
            FROM doctor_schedules ds
            INNER JOIN time_slots ts ON ds.slot_id = ts.slot_id
            INNER JOIN doctors d ON ds.doctor_id = d.doctor_id
            WHERE 1=1
        `;
        
        const request = pool.request();
        
        if (doctor_id) {
            query += ' AND ds.doctor_id = @doctor_id';
            request.input('doctor_id', sql.Int, doctor_id);
        }
        
        if (day_of_week !== undefined) {
            query += ' AND ds.day_of_week = @day_of_week';
            request.input('day_of_week', sql.TinyInt, day_of_week);
        }

        query += ' ORDER BY ds.day_of_week, ts.slot_number';

        const result = await request.query(query);
        res.json(result.recordset);
        
    } catch (err) {
        console.error('Error fetching schedules:', err);
        res.status(500).json({ error: 'Error fetching schedules' });
    }
});

// Update schedule by doctor
app.put('/api/schedules/:scheduleId', async (req, res) => {
    try {
        const scheduleId = parseInt(req.params.scheduleId, 10);
        const { day_of_week, slot_id, is_active } = req.body;

        const sets = [];
        const request = pool.request().input('schedule_id', sql.Int, scheduleId);
        
        if (day_of_week !== undefined) {
            sets.push('day_of_week = @day_of_week');
            request.input('day_of_week', sql.TinyInt, day_of_week);
        }
        
        if (slot_id !== undefined) {
            sets.push('slot_id = @slot_id');
            request.input('slot_id', sql.Int, slot_id);
        }
        
        if (is_active !== undefined) {
            sets.push('is_active = @is_active');
            request.input('is_active', sql.Bit, is_active);
        }

        if (sets.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        const query = `
            UPDATE doctor_schedules
            SET ${sets.join(', ')}, updated_at = GETDATE()
            WHERE schedule_id = @schedule_id;
            
            SELECT ds.*, ts.start_time, ts.end_time, ts.slot_number
            FROM doctor_schedules ds
            INNER JOIN time_slots ts ON ds.slot_id = ts.slot_id
            WHERE ds.schedule_id = @schedule_id;
        `;

        const result = await request.query(query);
        
        if (result.recordset.length === 0) {
            return res.status(404).json({ error: 'Schedule not found' });
        }
        
        res.json({ message: 'Schedule updated', schedule: result.recordset[0] });

    } catch (err) {
        console.error('Error updating schedule:', err);
        res.status(500).json({ error: 'Error updating schedule' });
    }
});

// Delete schedule
app.delete('/api/schedules/:scheduleId', async (req, res) => {
    try {
        const scheduleId = parseInt(req.params.scheduleId, 10);
        
        const result = await pool.request()
            .input('schedule_id', sql.Int, scheduleId)
            .query(`
                DELETE FROM doctor_schedules 
                WHERE schedule_id = @schedule_id;
                SELECT @@ROWCOUNT AS deleted;
            `);

        const deleted = result.recordset[0] && result.recordset[0].deleted;
        
        if (!deleted) {
            return res.status(404).json({ error: 'Schedule not found' });
        }
        
        res.json({ message: 'Schedule deleted' });
        
    } catch (err) {
        console.error('Error deleting schedule:', err);
        res.status(500).json({ error: 'Error deleting schedule' });
    }
});

// ADD RECEPTIONIST
app.post('/api/receptionists', async (req, res) => {
    try {
        const { first_name, last_name, password, contact_no } = req.body;

        if (!first_name || !last_name || !password) {
            return res.status(400).json({ error: "first_name, last_name, and password are required" });
        }

        const result = await pool.request()
            .input('first_name', sql.VarChar, first_name)
            .input('last_name', sql.VarChar, last_name)
            .input('password', sql.VarChar, password)
            .input('contact_no', sql.VarChar, contact_no || null)
            .query(`
                INSERT INTO receptionists (first_name, last_name, password, contact_no)
                OUTPUT INSERTED.*
                VALUES (@first_name, @last_name, @password, @contact_no)
            `);

        const receptionist = result.recordset[0];
        delete receptionist.password;

        res.status(201).json({
            message: "Receptionist added successfully",
            receptionist
        });

    } catch (err) {
        console.error("Error adding receptionist:", err);
        res.status(500).json({ error: "Error adding receptionist" });
    }
});

// GET ALL RECEPTIONISTS
app.get('/api/receptionists', async (req, res) => {
    try {
        const result = await pool.request().query(`
            SELECT receptionist_id, receptionist_login_id, first_name, last_name, contact_no, created_at
            FROM receptionists
            ORDER BY receptionist_id
        `);

        res.json(result.recordset);

    } catch (err) {
        console.error('Error fetching receptionists:', err);
        res.status(500).json({ error: 'Error fetching receptionists' });
    }
});


//appointmrnt booking
// Get available schedule for a doctor on a specific date
app.get('/api/doctors/:doctor_id/available-schedule', async (req, res) => {
    try {
        const { date } = req.query; // Expected format: YYYY-MM-DD
        const doctor_id = req.params.doctor_id;

        if (!date) {
            return res.status(400).json({ error: 'date query parameter is required (YYYY-MM-DD)' });
        }

        // Validate date is within next 7 days
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const maxDate = new Date(today);
        maxDate.setDate(today.getDate() + 7);
        
        const requestedDate = new Date(date + 'T00:00:00');
        
        if (requestedDate < today) {
            return res.status(400).json({ error: 'Cannot book appointments in the past' });
        }
        
        if (requestedDate > maxDate) {
            return res.status(400).json({ error: 'Appointments can only be booked up to 7 days in advance' });
        }

        // Parse date correctly to avoid timezone issues
        const dateParts = date.split('-');
        const appointmentDate = new Date(
            parseInt(dateParts[0]), 
            parseInt(dateParts[1]) - 1, 
            parseInt(dateParts[2])
        );
        const dayOfWeek = appointmentDate.getDay();

        console.log(`Fetching schedule for doctor_id: ${doctor_id}, date: ${date}, day_of_week: ${dayOfWeek}`);

        const result = await pool.request()
            .input('doctor_id', sql.Int, doctor_id)
            .input('day_of_week', sql.TinyInt, dayOfWeek)
            .input('appointment_date', sql.Date, date)
            .query(`
                SELECT 
                    ds.schedule_id,
                    ds.doctor_id,
                    ds.slot_id,
                    ds.day_of_week,
                    ts.start_time,
                    ts.end_time,
                    CASE 
                        WHEN EXISTS (
                            SELECT 1 
                            FROM appointments a 
                            WHERE a.doctor_id = ds.doctor_id 
                            AND a.slot_id = ds.slot_id 
                            AND a.appointment_date = @appointment_date
                            AND a.status_id != 3  -- Not cancelled
                        ) THEN 0
                        ELSE 1
                    END AS is_available,
                    CASE 
                        WHEN EXISTS (
                            SELECT 1 
                            FROM appointments a 
                            WHERE a.doctor_id = ds.doctor_id 
                            AND a.slot_id = ds.slot_id 
                            AND a.appointment_date = @appointment_date
                            AND a.status_id != 3
                        ) THEN 'Booked'
                        ELSE 'Available'
                    END AS slot_status
                FROM doctor_schedules ds
                INNER JOIN time_slots ts ON ds.slot_id = ts.slot_id
                WHERE ds.doctor_id = @doctor_id
                AND ds.day_of_week = @day_of_week
                AND ds.is_active = 1
                ORDER BY ts.start_time
            `);

        console.log(`Found ${result.recordset.length} slots for day_of_week ${dayOfWeek}`);

        // Get doctor info
        const doctorInfo = await pool.request()
            .input('doctor_id', sql.Int, doctor_id)
            .query(`
                SELECT 
                    d.doctor_id,
                    CONCAT(d.first_name, ' ', d.last_name) AS doctor_name,
                    s.specialization_name,
                    d.consultation_fee
                FROM doctors d
                INNER JOIN specializations s ON d.specialization_id = s.specialization_id
                WHERE d.doctor_id = @doctor_id
            `);

        if (doctorInfo.recordset.length === 0) {
            return res.status(404).json({ error: 'Doctor not found' });
        }

        res.json({
            doctor: doctorInfo.recordset[0],
            date: date,
            day_of_week: dayOfWeek,
            slots: result.recordset,
            available_count: result.recordset.filter(s => s.is_available === 1).length,
            total_slots: result.recordset.length
        });

    } catch (err) {
        console.error('Error fetching available schedule:', err);
        res.status(500).json({ error: 'Error fetching available schedule', details: err.message });
    }
});

// Get latest/most recent schedule (next 7 days availability)
app.get('/api/doctors/:doctor_id/latest-schedule', async (req, res) => {
    try {
        const doctor_id = req.params.doctor_id;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Get all active schedule slots for the doctor
        const scheduleResult = await pool.request()
            .input('doctor_id', sql.Int, doctor_id)
            .query(`
                SELECT 
                    ds.schedule_id,
                    ds.doctor_id,
                    ds.slot_id,
                    ds.day_of_week,
                    ts.start_time,
                    ts.end_time
                FROM doctor_schedules ds
                INNER JOIN time_slots ts ON ds.slot_id = ts.slot_id
                WHERE ds.doctor_id = @doctor_id
                AND ds.is_active = 1
                ORDER BY ds.day_of_week, ts.start_time
            `);

        if (scheduleResult.recordset.length === 0) {
            return res.status(404).json({ 
                error: 'No active schedule found for this doctor' 
            });
        }

        // Generate next 7 days with availability
        const availability = [];
        for (let i = 0; i < 7; i++) {
            const checkDate = new Date(today);
            checkDate.setDate(today.getDate() + i);
            const dayOfWeek = checkDate.getDay();
            const dateStr = checkDate.toISOString().split('T')[0];

            // Get slots for this day of week
            const daySlots = scheduleResult.recordset.filter(
                slot => slot.day_of_week === dayOfWeek
            );

            if (daySlots.length > 0) {
                // Check which slots are booked
                const bookedSlots = await pool.request()
                    .input('doctor_id', sql.Int, doctor_id)
                    .input('appointment_date', sql.Date, dateStr)
                    .query(`
                        SELECT slot_id 
                        FROM appointments 
                        WHERE doctor_id = @doctor_id 
                        AND appointment_date = @appointment_date
                        AND status_id != 3
                    `);

                const bookedSlotIds = bookedSlots.recordset.map(s => s.slot_id);

                const slotsWithAvailability = daySlots.map(slot => ({
                    ...slot,
                    is_available: !bookedSlotIds.includes(slot.slot_id),
                    slot_status: bookedSlotIds.includes(slot.slot_id) ? 'Booked' : 'Available'
                }));

                availability.push({
                    date: dateStr,
                    day_of_week: dayOfWeek,
                    day_name: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek],
                    slots: slotsWithAvailability,
                    available_slots: slotsWithAvailability.filter(s => s.is_available).length,
                    total_slots: slotsWithAvailability.length
                });
            }
        }

        // Get doctor info
        const doctorInfo = await pool.request()
            .input('doctor_id', sql.Int, doctor_id)
            .query(`
                SELECT 
                    d.doctor_id,
                    CONCAT(d.first_name, ' ', d.last_name) AS doctor_name,
                    s.specialization_name,
                    d.consultation_fee
                FROM doctors d
                INNER JOIN specializations s ON d.specialization_id = s.specialization_id
                WHERE d.doctor_id = @doctor_id
            `);

        const next7Days = new Date(today);
        next7Days.setDate(today.getDate() + 7);

        res.json({
            doctor: doctorInfo.recordset[0],
            schedule_period: {
                from: today.toISOString().split('T')[0],
                to: next7Days.toISOString().split('T')[0]
            },
            availability: availability
        });

    } catch (err) {
        console.error('Error fetching latest schedule:', err);
        res.status(500).json({ error: 'Error fetching latest schedule' });
    }
});

// Book a slot (creates appointment and marks slot as booked)
app.post('/api/slots/book', async (req, res) => {
    let transaction;
    
    try {
        const { 
            patient_id, 
            doctor_id, 
            appointment_date, 
            slot_id 
        } = req.body;

        // Basic validation only
        if (!patient_id || !doctor_id || !appointment_date || !slot_id) {
            return res.status(400).json({ 
                error: 'patient_id, doctor_id, appointment_date, and slot_id are required' 
            });
        }

        // Date validation - must be within next 7 days
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const maxDate = new Date(today);
        maxDate.setDate(today.getDate() + 7);
        
        const appointmentDateObj = new Date(appointment_date + 'T00:00:00');
        
        if (appointmentDateObj < today) {
            return res.status(400).json({ 
                error: 'Cannot book appointments in the past' 
            });
        }
        
        if (appointmentDateObj > maxDate) {
            return res.status(400).json({ 
                error: 'Appointments can only be booked up to 7 days in advance' 
            });
        }

        // Initialize transaction
        transaction = pool.transaction();
        await transaction.begin();

        // Single validation query to check patient, doctor exists and no duplicate appointment
        const validationResult = await transaction.request()
            .input('patient_id', sql.Int, patient_id)
            .input('doctor_id', sql.Int, doctor_id)
            .input('appointment_date', sql.Date, appointment_date)
            .query(`
                SELECT 
                    (SELECT COUNT(*) FROM patients WHERE patient_id = @patient_id) AS patient_exists,
                    (SELECT COUNT(*) FROM doctors WHERE doctor_id = @doctor_id) AS doctor_exists,
                    (SELECT COUNT(*) FROM appointments 
                     WHERE patient_id = @patient_id 
                     AND doctor_id = @doctor_id 
                     AND appointment_date = @appointment_date 
                     AND status_id != 3) AS has_existing_appointment
            `);

        const validation = validationResult.recordset[0];

        if (validation.patient_exists === 0) {
            await transaction.rollback();
            return res.status(404).json({ error: 'Patient not found' });
        }

        if (validation.doctor_exists === 0) {
            await transaction.rollback();
            return res.status(404).json({ error: 'Doctor not found' });
        }

        if (validation.has_existing_appointment > 0) {
            await transaction.rollback();
            return res.status(409).json({ 
                error: 'Patient already has an appointment with this doctor on this date' 
            });
        }

        // Insert appointment - let trigger handle slot/schedule validation
        try {
            // Insert without OUTPUT clause (due to trigger limitation)
            await transaction.request()
                .input('patient_id', sql.Int, patient_id)
                .input('doctor_id', sql.Int, doctor_id)
                .input('appointment_date', sql.Date, appointment_date)
                .input('slot_id', sql.Int, slot_id)
                .query(`
                    INSERT INTO appointments (patient_id, doctor_id, appointment_date, slot_id, status_id)
                    VALUES (@patient_id, @doctor_id, @appointment_date, @slot_id, 1)
                `);

            // Retrieve the newly created appointment_id
            const appointmentIdResult = await transaction.request()
                .input('patient_id', sql.Int, patient_id)
                .input('doctor_id', sql.Int, doctor_id)
                .input('appointment_date', sql.Date, appointment_date)
                .input('slot_id', sql.Int, slot_id)
                .query(`
                    SELECT TOP 1 appointment_id 
                    FROM appointments 
                    WHERE patient_id = @patient_id 
                    AND doctor_id = @doctor_id 
                    AND appointment_date = @appointment_date 
                    AND slot_id = @slot_id
                    ORDER BY created_at DESC
                `);

            const appointment_id = appointmentIdResult.recordset[0].appointment_id;

            // Get full appointment details in one query
            const appointmentDetails = await transaction.request()
                .input('appointment_id', sql.Int, appointment_id)
                .query(`
                    SELECT 
                        a.appointment_id,
                        a.patient_id,
                        CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
                        p.phone_no AS patient_phone,
                        a.doctor_id,
                        CONCAT(d.first_name, ' ', d.last_name) AS doctor_name,
                        s.specialization_name,
                        a.appointment_date,
                        a.slot_id,
                        ts.start_time,
                        ts.end_time,
                        ast.status_name,
                        d.consultation_fee,
                        a.created_at
                    FROM appointments a
                    INNER JOIN patients p ON a.patient_id = p.patient_id
                    INNER JOIN doctors d ON a.doctor_id = d.doctor_id
                    INNER JOIN specializations s ON d.specialization_id = s.specialization_id
                    INNER JOIN time_slots ts ON a.slot_id = ts.slot_id
                    INNER JOIN appointment_statuses ast ON a.status_id = ast.status_id
                    WHERE a.appointment_id = @appointment_id
                `);

            await transaction.commit();

            res.status(201).json({
                message: 'Slot booked successfully',
                appointment: appointmentDetails.recordset[0]
            });

        } catch (insertErr) {
            await transaction.rollback();
            
            // Handle trigger-specific errors
            if (insertErr.message) {
                if (insertErr.message.includes('not available in the doctor')) {
                    return res.status(400).json({ 
                        error: 'This slot is not in the doctor\'s schedule for this day' 
                    });
                }
                if (insertErr.message.includes('already booked')) {
                    return res.status(409).json({ 
                        error: 'This slot is already booked for the selected date' 
                    });
                }
            }
            
            throw insertErr;
        }

    } catch (err) {
        // Only rollback if transaction was started
        if (transaction && transaction._acquiredConnection) {
            try {
                await transaction.rollback();
            } catch (rollbackErr) {
                console.error('Error rolling back transaction:', rollbackErr);
            }
        }
        console.error('Error booking slot:', err);
        res.status(500).json({ error: 'Error booking slot', details: err.message });
    }
});

// Check if a specific slot is available
app.get('/api/slots/check-availability', async (req, res) => {
    try {
        const { doctor_id, slot_id, appointment_date } = req.query;

        if (!doctor_id || !slot_id || !appointment_date) {
            return res.status(400).json({ 
                error: 'doctor_id, slot_id, and appointment_date are required' 
            });
        }

        // Validate date is within next 7 days
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const maxDate = new Date(today);
        maxDate.setDate(today.getDate() + 7);
        
        const requestedDate = new Date(appointment_date + 'T00:00:00');
        
        if (requestedDate < today) {
            return res.json({
                is_available: false,
                reason: 'Cannot book appointments in the past'
            });
        }
        
        if (requestedDate > maxDate) {
            return res.json({
                is_available: false,
                reason: 'Appointments can only be booked up to 7 days in advance'
            });
        }

        const dayOfWeek = new Date(appointment_date).getDay();

        // Single optimized query to check everything
        const result = await pool.request()
            .input('doctor_id', sql.Int, doctor_id)
            .input('slot_id', sql.Int, slot_id)
            .input('appointment_date', sql.Date, appointment_date)
            .input('day_of_week', sql.TinyInt, dayOfWeek)
            .query(`
                SELECT 
                    ds.schedule_id,
                    ts.start_time,
                    ts.end_time,
                    CASE 
                        WHEN ds.schedule_id IS NULL THEN 'Not in doctor schedule'
                        WHEN ds.is_active = 0 THEN 'Schedule inactive'
                        WHEN EXISTS (
                            SELECT 1 FROM appointments 
                            WHERE doctor_id = @doctor_id 
                            AND slot_id = @slot_id 
                            AND appointment_date = @appointment_date
                            AND status_id != 3
                        ) THEN 'Already booked'
                        ELSE 'Available'
                    END AS availability_status,
                    CASE 
                        WHEN ds.schedule_id IS NOT NULL 
                        AND ds.is_active = 1
                        AND NOT EXISTS (
                            SELECT 1 FROM appointments 
                            WHERE doctor_id = @doctor_id 
                            AND slot_id = @slot_id 
                            AND appointment_date = @appointment_date
                            AND status_id != 3
                        ) THEN 1
                        ELSE 0
                    END AS is_available
                FROM doctor_schedules ds
                INNER JOIN time_slots ts ON ds.slot_id = ts.slot_id
                WHERE ds.doctor_id = @doctor_id 
                AND ds.slot_id = @slot_id 
                AND ds.day_of_week = @day_of_week
            `);

        if (result.recordset.length === 0) {
            return res.json({
                is_available: false,
                reason: 'Slot not in doctor\'s schedule for this day of week'
            });
        }

        const slotInfo = result.recordset[0];

        res.json({
            is_available: slotInfo.is_available === 1,
            slot_details: {
                start_time: slotInfo.start_time,
                end_time: slotInfo.end_time
            },
            reason: slotInfo.availability_status
        });

    } catch (err) {
        console.error('Error checking availability:', err);
        res.status(500).json({ error: 'Error checking availability' });
    }
});


// CREATE APPOINTMENT FORM
app.post('/api/appointment-forms', async (req, res) => {
    try {
        const { appointment_id, patient_id, symptoms, medical_history } = req.body;

        // Validate required fields
        if (!appointment_id || !patient_id || !symptoms) {
            return res.status(400).json({ 
                error: 'appointment_id, patient_id, and symptoms are required' 
            });
        }

        // Validate that appointment exists and belongs to the patient
        const appointmentCheck = await pool.request()
            .input('appointment_id', sql.Int, appointment_id)
            .input('patient_id', sql.Int, patient_id)
            .query(`
                SELECT appointment_id, patient_id, doctor_id, appointment_date, status_id
                FROM appointments 
                WHERE appointment_id = @appointment_id 
                AND patient_id = @patient_id
            `);

        if (appointmentCheck.recordset.length === 0) {
            return res.status(404).json({ 
                error: 'Appointment not found or does not belong to this patient' 
            });
        }

        // Check if form already exists for this appointment
        const existingForm = await pool.request()
            .input('appointment_id', sql.Int, appointment_id)
            .query(`
                SELECT form_id FROM appointment_forms 
                WHERE appointment_id = @appointment_id
            `);

        if (existingForm.recordset.length > 0) {
            return res.status(409).json({ 
                error: 'Appointment form already exists for this appointment' 
            });
        }

        // Insert the appointment form
        const result = await pool.request()
            .input('appointment_id', sql.Int, appointment_id)
            .input('patient_id', sql.Int, patient_id)
            .input('symptoms', sql.VarChar, symptoms)
            .input('medical_history', sql.VarChar, medical_history || null)
            .query(`
                INSERT INTO appointment_forms (appointment_id, patient_id, symptoms, medical_history)
                OUTPUT INSERTED.*
                VALUES (@appointment_id, @patient_id, @symptoms, @medical_history)
            `);

        res.status(201).json({
            message: 'Appointment form submitted successfully',
            form: result.recordset[0]
        });

    } catch (err) {
        console.error('Error creating appointment form:', err);
        res.status(500).json({ error: 'Error creating appointment form' });
    }
});

// GET APPOINTMENT FORM BY APPOINTMENT ID
app.get('/api/appointment-forms/:appointmentId', async (req, res) => {
    try {
        const appointmentId = parseInt(req.params.appointmentId, 10);
        
        const result = await pool.request()
            .input('appointment_id', sql.Int, appointmentId)
            .query(`
                SELECT af.*, 
                    CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
                    CONCAT(d.first_name, ' ', d.last_name) AS doctor_name
                FROM appointment_forms af
                INNER JOIN patients p ON af.patient_id = p.patient_id
                INNER JOIN appointments a ON af.appointment_id = a.appointment_id
                INNER JOIN doctors d ON a.doctor_id = d.doctor_id
                INNER JOIN specializations s ON d.specialization_id = s.specialization_id
                WHERE af.appointment_id = @appointment_id
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({ error: 'Appointment form not found' });
        }

        res.json(result.recordset[0]);
    } catch (err) {
        console.error('Error fetching appointment form:', err);
        res.status(500).json({ error: 'Error fetching appointment form' });
    }
});

// GET ALL APPOINTMENT FORMS FOR A PATIENT
app.get('/api/patients/:patientId/appointment-forms', async (req, res) => {
    try {
        const patientId = parseInt(req.params.patientId, 10);
        
        const result = await pool.request()
            .input('patient_id', sql.Int, patientId)
            .query(`
                SELECT af.*, 
                    a.appointment_date,
                    CONCAT(d.first_name, ' ', d.last_name) AS doctor_name,
                    s.specialization_name
                FROM appointment_forms af
                INNER JOIN appointments a ON af.appointment_id = a.appointment_id
                INNER JOIN doctors d ON a.doctor_id = d.doctor_id
                INNER JOIN specializations s ON d.specialization_id = s.specialization_id
                WHERE af.patient_id = @patient_id
                ORDER BY af.created_at DESC
            `);

        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching patient appointment forms:', err);
        res.status(500).json({ error: 'Error fetching appointment forms' });
    }
});


//consultancy routes
// CREATE CONSULTATION
app.post('/api/consultations', async (req, res) => {
    try {
        const {
            appointment_id,
            doctor_id,
            patient_id,
            blood_pressure,
            temperature,
            oxygen_saturation,
            diagnosis
        } = req.body;

        if (!appointment_id || !doctor_id || !patient_id) {
            return res.status(400).json({ 
                error: 'appointment_id, doctor_id, and patient_id are required' 
            });
        }

        const result = await pool.request()
            .input('appointment_id', sql.Int, appointment_id)
            .input('doctor_id', sql.Int, doctor_id)
            .input('patient_id', sql.Int, patient_id)
            .input('blood_pressure', sql.VarChar, blood_pressure || null)
            .input('temperature', sql.Decimal(4, 2), temperature || null)
            .input('oxygen_saturation', sql.Int, oxygen_saturation || null)
            .input('diagnosis', sql.VarChar, diagnosis || null)
            .query(`
                INSERT INTO consultations (
                    appointment_id, doctor_id, patient_id, 
                    blood_pressure, temperature, oxygen_saturation, diagnosis
                )
                OUTPUT INSERTED.*
                VALUES (
                    @appointment_id, @doctor_id, @patient_id,
                    @blood_pressure, @temperature, @oxygen_saturation, @diagnosis
                )
            `);

        res.status(201).json({
            message: 'Consultation created successfully',
            consultation: result.recordset[0]
        });
    } catch (err) {
        console.error('Error creating consultation:', err);
        res.status(500).json({ error: 'Error creating consultation' });
    }
});

// GET CONSULTATION BY ID
app.get('/api/consultations/:id', async (req, res) => {
    try {
        const consultationId = parseInt(req.params.id, 10);
        
        const result = await pool.request()
            .input('consultation_id', sql.Int, consultationId)
            .query(`
                SELECT c.*,
                    CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
                    CONCAT(d.first_name, ' ', d.last_name) AS doctor_name,
                    a.appointment_date
                FROM consultations c
                INNER JOIN patients p ON c.patient_id = p.patient_id
                INNER JOIN doctors d ON c.doctor_id = d.doctor_id
                INNER JOIN appointments a ON c.appointment_id = a.appointment_id
                WHERE c.consultation_id = @consultation_id
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({ error: 'Consultation not found' });
        }

        res.json(result.recordset[0]);
    } catch (err) {
        console.error('Error fetching consultation:', err);
        res.status(500).json({ error: 'Error fetching consultation' });
    }
});
// CHECK IF CONSULTATION EXISTS FOR APPOINTMENT
app.get('/api/consultations/appointment/:appointmentId', async (req, res) => {
    try {
        const { appointmentId } = req.params;
        
        const result = await pool.request()
            .input('appointment_id', sql.Int, appointmentId)
            .query(`
                SELECT consultation_id, diagnosis, consultation_date
                FROM consultations 
                WHERE appointment_id = @appointment_id
            `);

        if (result.recordset.length === 0) {
            return res.json({ 
                exists: false,
                message: 'No consultation found for this appointment' 
            });
        }

        res.json({
            exists: true,
            consultation: result.recordset[0]
        });
    } catch (err) {
        console.error('Error checking consultation:', err);
        res.status(500).json({ error: 'Error checking consultation' });
    }
});
// UPDATE APPOINTMENT STATUS (to mark as completed)
app.put('/api/appointments/:appointmentId/status', async (req, res) => {
  console.log('🔄 Status update endpoint called for appointment:', req.params.appointmentId);
  
  try {
    const appointmentId = parseInt(req.params.appointmentId);
    const { updated_by_doctor_id } = req.body;

    console.log('Parsed appointment ID:', appointmentId);
    console.log('Request body:', req.body);

    // 1. First, ensure status_id = 2 exists
    const checkStatusQuery = `SELECT status_id FROM appointment_statuses WHERE status_id = 2`;
    const statusCheckResult = await pool.request().query(checkStatusQuery);
    
    if (statusCheckResult.recordset.length === 0) {
      console.log('Status 2 does not exist, creating it...');
      await pool.request().query(`INSERT INTO appointment_statuses (status_id, status_name) VALUES (2, 'Completed')`);
      console.log('Created status_id = 2 (Completed)');
    }

    // 2. Check if appointment exists
    const checkAppointmentQuery = `SELECT appointment_id, status_id FROM appointments WHERE appointment_id = @appointment_id`;
    const checkResult = await pool.request()
      .input('appointment_id', sql.Int, appointmentId)
      .query(checkAppointmentQuery);

    if (checkResult.recordset.length === 0) {
      console.log('❌ Appointment not found:', appointmentId);
      return res.status(404).json({ error: 'Appointment not found' });
    }

    const currentStatus = checkResult.recordset[0].status_id;
    console.log('Current status:', currentStatus);
    
    // 3. Check if consultation exists for this appointment
    const consultationCheckQuery = `SELECT consultation_id FROM consultations WHERE appointment_id = @appointment_id`;
    const consultationResult = await pool.request()
      .input('appointment_id', sql.Int, appointmentId)
      .query(consultationCheckQuery);

    const hasConsultation = consultationResult.recordset.length > 0;
    console.log('Has consultation:', hasConsultation, 'Count:', consultationResult.recordset.length);
    
    // Determine new status
    let newStatus;
    let updateMessage;
    
    if (hasConsultation) {
      newStatus = 2; // Completed
      updateMessage = 'Appointment marked as completed (consultation exists)';
    } else {
      // If no consultation, keep current status or set to 1 if NULL
      newStatus = currentStatus !== null ? currentStatus : 1;
      updateMessage = 'Appointment status updated';
    }

    console.log('New status will be:', newStatus);

    // 4. Update appointment status
    const updateQuery = `
      UPDATE appointments 
      SET status_id = @newStatus
      WHERE appointment_id = @appointment_id
    `;

    console.log('Executing update query:', updateQuery);
    
    const result = await pool.request()
      .input('appointment_id', sql.Int, appointmentId)
      .input('newStatus', sql.Int, newStatus)
      .query(updateQuery);

    console.log('Rows affected:', result.rowsAffected[0]);

    if (result.rowsAffected[0] === 0) {
      console.log('❌ No rows affected - update failed');
      return res.status(404).json({ error: 'Appointment not found or update failed' });
    }

    // 5. Verify the update
    const verifyQuery = `SELECT appointment_id, status_id FROM appointments WHERE appointment_id = @appointment_id`;
    const verifyResult = await pool.request()
      .input('appointment_id', sql.Int, appointmentId)
      .query(verifyQuery);
    
    const verifiedStatus = verifyResult.recordset[0]?.status_id;
    console.log('Verified new status:', verifiedStatus);

    // 6. Get status name for response
    const statusNameQuery = `SELECT status_name FROM appointment_statuses WHERE status_id = @status_id`;
    const statusNameResult = await pool.request()
      .input('status_id', sql.Int, newStatus)
      .query(statusNameQuery);
    
    const statusName = statusNameResult.recordset[0]?.status_name || 'Unknown';

    res.json({
      success: true,
      message: updateMessage,
      consultation_exists: hasConsultation,
      previous_status: currentStatus,
      new_status: newStatus,
      verified_status: verifiedStatus,
      status_name: statusName,
      rows_affected: result.rowsAffected[0]
    });

    console.log('✅ Status update completed successfully');

  } catch (error) {
    console.error('❌ Error updating appointment status:', error);
    console.error('Error details:', error.message);
    console.error('Error code:', error.code);
    console.error('Error stack:', error.stack);
    
    res.status(500).json({ 
      error: 'Failed to update appointment status',
      details: error.message,
      code: error.code
    });
  }
});

//ADD PRESCRIBED MEDICINE
app.post('/api/prescribed-medicines', async (req, res) => {
    try {
        const {
            consultation_id,
            medicine_name,
            dosage,
            frequency,
            duration
        } = req.body;

        if (!consultation_id || !medicine_name || !dosage || !frequency || !duration) {
            return res.status(400).json({ 
                error: 'All medicine fields are required' 
            });
        }

        const result = await pool.request()
            .input('consultation_id', sql.Int, consultation_id)
            .input('medicine_name', sql.VarChar, medicine_name)
            .input('dosage', sql.VarChar, dosage)
            .input('frequency', sql.VarChar, frequency)
            .input('duration', sql.VarChar, duration)
            .query(`
                INSERT INTO prescribed_medicines (
                    consultation_id, medicine_name, dosage, frequency, duration
                )
                OUTPUT INSERTED.*
                VALUES (
                    @consultation_id, @medicine_name, @dosage, @frequency, @duration
                )
            `);

        res.status(201).json({
            message: 'Medicine prescribed successfully',
            medicine: result.recordset[0]
        });
    } catch (err) {
        console.error('Error prescribing medicine:', err);
        res.status(500).json({ error: 'Error prescribing medicine' });
    }
});

// GET MEDICINES FOR CONSULTATION
app.get('/api/consultations/:consultationId/medicines', async (req, res) => {
    try {
        const consultationId = parseInt(req.params.consultationId, 10);
        
        const result = await pool.request()
            .input('consultation_id', sql.Int, consultationId)
            .query(`
                SELECT * FROM prescribed_medicines 
                WHERE consultation_id = @consultation_id
                ORDER BY created_at
            `);

        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching prescribed medicines:', err);
        res.status(500).json({ error: 'Error fetching medicines' });
    }
});








// GET ALL CONSULTATIONS FOR A PATIENT
app.get('/api/patients/:patientId/consultations', async (req, res) => {
    try {
        const patientId = parseInt(req.params.patientId, 10);
        
        const result = await pool.request()
            .input('patient_id', sql.Int, patientId)
            .query(`
                SELECT c.*,
                    CONCAT(d.first_name, ' ', d.last_name) AS doctor_name,
                    s.specialization_name,
                    a.appointment_date
                FROM consultations c
                INNER JOIN doctors d ON c.doctor_id = d.doctor_id
                INNER JOIN specializations s ON d.specialization_id = s.specialization_id
                INNER JOIN appointments a ON c.appointment_id = a.appointment_id
                WHERE c.patient_id = @patient_id
                ORDER BY c.consultation_date DESC
            `);

        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching patient consultations:', err);
        res.status(500).json({ error: 'Error fetching consultations' });
    }
});

// GET ALL CONSULTATIONS FOR A DOCTOR
app.get('/api/doctors/:doctorId/consultations', async (req, res) => {
    try {
        const doctorId = parseInt(req.params.doctorId, 10);
        
        const result = await pool.request()
            .input('doctor_id', sql.Int, doctorId)
            .query(`
                SELECT c.*,
                    CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
                    p.age, p.gender, p.blood_group,
                    a.appointment_date
                FROM consultations c
                INNER JOIN patients p ON c.patient_id = p.patient_id
                INNER JOIN appointments a ON c.appointment_id = a.appointment_id
                WHERE c.doctor_id = @doctor_id
                ORDER BY c.consultation_date DESC
            `);

        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching doctor consultations:', err);
        res.status(500).json({ error: 'Error fetching consultations' });
    }
});



// ============================================
// ACTION TYPES ROUTES
// ============================================

// GET ALL ACTION TYPES
app.get('/api/action-types', async (req, res) => {
    try {
        const result = await pool.request().query(`
            SELECT * FROM action_types ORDER BY action_name
        `);
        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching action types:', err);
        res.status(500).json({ error: 'Error fetching action types' });
    }
});


// CREATE CONSULTATION ACTION
app.post('/api/consultation-actions', async (req, res) => {
    try {
        const { consultation_id, action_type_id, notes } = req.body;

        if (!consultation_id || !action_type_id) {
            return res.status(400).json({ 
                error: 'consultation_id and action_type_id are required' 
            });
        }

        const result = await pool.request()
            .input('consultation_id', sql.Int, consultation_id)
            .input('action_type_id', sql.Int, action_type_id)
            .input('notes', sql.VarChar, notes || null)
            .query(`
                INSERT INTO consultation_actions (consultation_id, action_type_id, notes)
                OUTPUT INSERTED.*
                VALUES (@consultation_id, @action_type_id, @notes)
            `);

        res.status(201).json({
            message: 'Consultation action created successfully',
            action: result.recordset[0]
        });
    } catch (err) {
        console.error('Error creating consultation action:', err);
        res.status(500).json({ error: 'Error creating consultation action' });
    }
});






// GET CONSULTATION ACTIONS FOR A CONSULTATION
app.get('/api/consultations/:consultationId/actions', async (req, res) => {
    try {
        const consultationId = parseInt(req.params.consultationId, 10);
        
        const result = await pool.request()
            .input('consultation_id', sql.Int, consultationId)
            .query(`
                SELECT ca.*, at.action_name
                FROM consultation_actions ca
                INNER JOIN action_types at ON ca.action_type_id = at.action_type_id
                WHERE ca.consultation_id = @consultation_id
                ORDER BY ca.created_at DESC
            `);

        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching consultation actions:', err);
        res.status(500).json({ error: 'Error fetching consultation actions' });
    }
});

// UPDATE CONSULTATION ACTION STATUS
app.put('/api/consultation-actions/:id', async (req, res) => {
    try {
        const actionId = parseInt(req.params.id, 10);
        const { status, notes } = req.body;

        const sets = [];
        const request = pool.request().input('action_id', sql.Int, actionId);

        if (status !== undefined) {
            sets.push('status = @status');
            request.input('status', sql.VarChar, status);
            
            if (status === 'Completed') {
                sets.push('completed_at = GETDATE()');
            }
        }

        if (notes !== undefined) {
            sets.push('notes = @notes');
            request.input('notes', sql.VarChar, notes);
        }

        if (sets.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        const query = `
            UPDATE consultation_actions 
            SET ${sets.join(', ')}
            WHERE action_id = @action_id;
            SELECT * FROM consultation_actions WHERE action_id = @action_id;
        `;

        const result = await request.query(query);

        if (result.recordset.length === 0) {
            return res.status(404).json({ error: 'Action not found' });
        }

        res.json({
            message: 'Action updated successfully',
            action: result.recordset[0]
        });
    } catch (err) {
        console.error('Error updating consultation action:', err);
        res.status(500).json({ error: 'Error updating consultation action' });
    }
});
app.get('/api/patient/appointment/:appointmentId', async (req, res) => {
    try {
        const appointmentId = parseInt(req.params.appointmentId);
        
        if (isNaN(appointmentId)) {
            return res.status(400).json({ error: 'Invalid appointment ID' });
        }
        
        const query = `
            SELECT 
                -- From patients table
                CONCAT(p.first_name, ' ', p.last_name) AS name,
                p.age,
                p.gender,
                
                -- From appointment_forms (symptoms and using medical_history as allergies)
                af.symptoms,
                af.medical_history
                
            FROM appointments a
            INNER JOIN patients p ON a.patient_id = p.patient_id
            LEFT JOIN appointment_forms af ON a.appointment_id = af.appointment_id
            WHERE a.appointment_id = @appointmentId
        `;
        
        const result = await pool.request()
            .input('appointmentId', sql.Int, appointmentId)
            .query(query);
        
        if (result.recordset.length === 0) {
            return res.status(404).json({ error: 'Appointment not found' });
        }
        
        const appointmentData = result.recordset[0];
        
        res.json({
            name: appointmentData.name || 'Unknown',
            age: appointmentData.age || 'N/A',
            gender: appointmentData.gender || 'Not specified',
            symptoms: appointmentData.symptoms || 'No symptoms recorded',
            allergies: appointmentData.medical_history || 'No medical history recorded'  // medical_history as allergies
        });
        
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            details: error.message 
        });
    }
});
// CREATE PATIENT VISIT
app.post('/api/patient-visits', async (req, res) => {
    try {
        const {
            admission_id,
            patient_id,
            doctor_id,
            blood_pressure,
            temperature,
            oxygen_saturation,
            pulse_rate,
            condition_status,
            notes,
            treatment_given,
            ready_for_discharge,
            discharge_recommended_date
        } = req.body;

        if (!admission_id || !patient_id || !doctor_id) {
            return res.status(400).json({ 
                error: 'admission_id, patient_id, and doctor_id are required' 
            });
        }

        const result = await pool.request()
            .input('admission_id', sql.Int, admission_id)
            .input('patient_id', sql.Int, patient_id)
            .input('doctor_id', sql.Int, doctor_id)
            .input('blood_pressure', sql.VarChar, blood_pressure || null)
            .input('temperature', sql.Decimal(4, 2), temperature || null)
            .input('oxygen_saturation', sql.Int, oxygen_saturation || null)
            .input('pulse_rate', sql.Int, pulse_rate || null)
            .input('condition_status', sql.VarChar, condition_status || null)
            .input('notes', sql.VarChar, notes || null)
            .input('treatment_given', sql.VarChar, treatment_given || null)
            .input('ready_for_discharge', sql.Bit, ready_for_discharge || 0)
            .input('discharge_recommended_date', sql.DateTime, discharge_recommended_date || null)
            .query(`
                INSERT INTO admitted_patient_visits (
                    admission_id, patient_id, doctor_id, blood_pressure,
                    temperature, oxygen_saturation, pulse_rate,
                    condition_status, notes, treatment_given,
                    ready_for_discharge, discharge_recommended_date
                )
                OUTPUT INSERTED.*
                VALUES (
                    @admission_id, @patient_id, @doctor_id, @blood_pressure,
                    @temperature, @oxygen_saturation, @pulse_rate,
                    @condition_status, @notes, @treatment_given,
                    @ready_for_discharge, @discharge_recommended_date
                )
            `);

        res.status(201).json({
            message: 'Patient visit recorded successfully',
            visit: result.recordset[0]
        });
    } catch (err) {
        console.error('Error creating patient visit:', err);
        res.status(500).json({ error: 'Error creating patient visit' });
    }
});

// GET ALL VISITS FOR AN ADMISSION
app.get('/api/admissions/:admissionId/visits', async (req, res) => {
    try {
        const admissionId = parseInt(req.params.admissionId, 10);
        
        const result = await pool.request()
            .input('admission_id', sql.Int, admissionId)
            .query(`
                SELECT v.*,
                    CONCAT(d.first_name, ' ', d.last_name) AS doctor_name
                FROM admitted_patient_visits v
                INNER JOIN doctors d ON v.doctor_id = d.doctor_id
                WHERE v.admission_id = @admission_id
                ORDER BY v.visit_datetime DESC
            `);

        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching patient visits:', err);
        res.status(500).json({ error: 'Error fetching patient visits' });
    }
});


// CREATE DISCHARGE (Complete version)
app.post('/api/discharges', async (req, res) => {
    const transaction = pool.transaction();
    
    try {
        const {
            admission_id, patient_id, doctor_id,
            room_charges, medical_charges, doctor_visit_charges,
            lab_charges, other_charges,
            final_diagnosis, discharge_summary, discharge_instructions,
            follow_up_required, follow_up_date,
            processed_by_receptionist_id, discharge_approved_by_visit_id
        } = req.body;

        if (!admission_id || !patient_id || !doctor_id || !processed_by_receptionist_id) {
            return res.status(400).json({ error: 'Required fields missing' });
        }

        await transaction.begin();

        // Get admission details
        const admissionResult = await transaction.request()
            .input('admission_id', sql.Int, admission_id)
            .query('SELECT admission_date, is_active FROM admissions WHERE admission_id = @admission_id');

        if (admissionResult.recordset.length === 0) {
            await transaction.rollback();
            return res.status(404).json({ error: 'Admission not found' });
        }

        const admission = admissionResult.recordset[0];
        if (!admission.is_active) {
            await transaction.rollback();
            return res.status(400).json({ error: 'Admission already discharged' });
        }

        const totalDays = Math.ceil((new Date() - new Date(admission.admission_date)) / (1000 * 60 * 60 * 24));
        const totalAmount = parseFloat(room_charges || 0) + parseFloat(medical_charges || 0) + 
                          parseFloat(doctor_visit_charges || 0) + parseFloat(lab_charges || 0) + 
                          parseFloat(other_charges || 0);

        // Create discharge
        const dischargeResult = await transaction.request()
            .input('admission_id', sql.Int, admission_id)
            .input('patient_id', sql.Int, patient_id)
            .input('doctor_id', sql.Int, doctor_id)
            .input('total_days', sql.Int, totalDays)
            .input('room_charges', sql.Decimal(10, 2), room_charges || 0)
            .input('medical_charges', sql.Decimal(10, 2), medical_charges || 0)
            .input('doctor_visit_charges', sql.Decimal(10, 2), doctor_visit_charges || 0)
            .input('lab_charges', sql.Decimal(10, 2), lab_charges || 0)
            .input('other_charges', sql.Decimal(10, 2), other_charges || 0)
            .input('total_amount', sql.Decimal(10, 2), totalAmount)
            .input('final_diagnosis', sql.VarChar, final_diagnosis || null)
            .input('discharge_summary', sql.VarChar, discharge_summary || null)
            .input('discharge_instructions', sql.VarChar, discharge_instructions || null)
            .input('follow_up_required', sql.Bit, follow_up_required || 0)
            .input('follow_up_date', sql.Date, follow_up_date || null)
            .input('processed_by_receptionist_id', sql.Int, processed_by_receptionist_id)
            .input('discharge_approved_by_visit_id', sql.Int, discharge_approved_by_visit_id || null)
            .query(`
                INSERT INTO discharges (
                    admission_id, patient_id, doctor_id, total_days,
                    room_charges, medical_charges, doctor_visit_charges,
                    lab_charges, other_charges, total_amount,
                    final_diagnosis, discharge_summary, discharge_instructions,
                    follow_up_required, follow_up_date,
                    processed_by_receptionist_id, discharge_approved_by_visit_id
                ) OUTPUT INSERTED.*
                VALUES (
                    @admission_id, @patient_id, @doctor_id, @total_days,
                    @room_charges, @medical_charges, @doctor_visit_charges,
                    @lab_charges, @other_charges, @total_amount,
                    @final_diagnosis, @discharge_summary, @discharge_instructions,
                    @follow_up_required, @follow_up_date,
                    @processed_by_receptionist_id, @discharge_approved_by_visit_id
                )
            `);

        // Update admission to inactive
        await transaction.request()
            .input('admission_id', sql.Int, admission_id)
            .query('UPDATE admissions SET is_active = 0, discharge_date = GETDATE() WHERE admission_id = @admission_id');

        await transaction.commit();

        res.status(201).json({
            message: 'Patient discharged successfully',
            discharge: dischargeResult.recordset[0]
        });

    } catch (err) {
        await transaction.rollback();
        console.error('Error creating discharge:', err);
        res.status(500).json({ error: 'Error creating discharge' });
    }
});


// GET DISCHARGE BY ADMISSION ID
app.get('/api/discharges/admission/:admissionId', async (req, res) => {
    try {
        const admissionId = parseInt(req.params.admissionId, 10);
        
        const result = await pool.request()
            .input('admission_id', sql.Int, admissionId)
            .query(`
                SELECT d.*,
                    CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
                    CONCAT(doc.first_name, ' ', doc.last_name) AS doctor_name,
                    CONCAT(rec.first_name, ' ', rec.last_name) AS receptionist_name
                FROM discharges d
                INNER JOIN patients p ON d.patient_id = p.patient_id
                INNER JOIN doctors doc ON d.doctor_id = doc.doctor_id
                INNER JOIN receptionists rec ON d.processed_by_receptionist_id = rec.receptionist_id
                WHERE d.admission_id = @admission_id
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({ error: 'Discharge not found' });
        }

        res.json(result.recordset[0]);
    } catch (err) {
        console.error('Error fetching discharge:', err);
        res.status(500).json({ error: 'Error fetching discharge' });
    }
});

// GET ALL DISCHARGES (with filters)
app.get('/api/discharges', async (req, res) => {
    try {
        const { patient_id, payment_status } = req.query;
        
        let query = `
            SELECT d.*,
                CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
                CONCAT(doc.first_name, ' ', doc.last_name) AS doctor_name,
                CONCAT(rec.first_name, ' ', rec.last_name) AS receptionist_name
            FROM discharges d
            INNER JOIN patients p ON d.patient_id = p.patient_id
            INNER JOIN doctors doc ON d.doctor_id = doc.doctor_id
            INNER JOIN receptionists rec ON d.processed_by_receptionist_id = rec.receptionist_id
            WHERE 1=1
        `;
        
        const request = pool.request();
        
        if (patient_id) {
            query += ' AND d.patient_id = @patient_id';
            request.input('patient_id', sql.Int, patient_id);
        }
        
        if (payment_status) {
            query += ' AND d.payment_status = @payment_status';
            request.input('payment_status', sql.VarChar, payment_status);
        }
        
        query += ' ORDER BY d.discharge_date DESC';
        
        const result = await request.query(query);
        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching discharges:', err);
        res.status(500).json({ error: 'Error fetching discharges' });
    }
});




// GET DOCTOR'S PATIENTS WITH CONSULTATION SUMMARY
app.get('/api/doctors/:doctorId/patients-summary', async (req, res) => {
    try {
        const doctorId = parseInt(req.params.doctorId, 10);
        const { gender } = req.query; // Optional gender filter
        
        let query = `
            SELECT 
                p.patient_id,
                p.patient_login_id,
                p.first_name,
                p.last_name,
                p.gender,
                p.age,
                p.blood_group,
                p.phone_no,
                COUNT(c.consultation_id) AS total_consultations,
                MAX(c.consultation_date) AS last_consultation_date,
                MAX(c.diagnosis) AS latest_diagnosis
            FROM patients p
            INNER JOIN consultations c ON p.patient_id = c.patient_id
            WHERE c.doctor_id = @doctor_id
        `;
        
        const request = pool.request()
            .input('doctor_id', sql.Int, doctorId);
        
        // Add gender filter if provided
        if (gender && (gender.toLowerCase() === 'male' || gender.toLowerCase() === 'female')) {
            query += ' AND p.gender = @gender';
            request.input('gender', sql.VarChar, gender);
        }
        
        query += `
            GROUP BY 
                p.patient_id,
                p.patient_login_id,
                p.first_name,
                p.last_name,
                p.gender,
                p.age,
                p.blood_group,
                p.phone_no
            ORDER BY MAX(c.consultation_date) DESC, p.first_name, p.last_name
        `;
        
        const result = await request.query(query);
        res.json(result.recordset);
        
    } catch (err) {
        console.error('Error fetching doctor patients summary:', err);
        res.status(500).json({ error: 'Error fetching patients summary' });
    }
});

// ============================================
// PATIENT RECORDS FOR PATIENT DASHBOARD
// ============================================

// GET PATIENT CONSULTATION RECORDS FOR PATIENT DASHBOARD
// NOTE: Endpoint path is duplicated in previous section, but function content is distinct.
// Using this specific implementation for patient dashboard data.
app.get('/api/patients/:patientId/consultations', async (req, res) => {
    try {
        const patientId = parseInt(req.params.patientId, 10);
        
        const result = await pool.request()
            .input('patient_id', sql.Int, patientId)
            .query(`
                SELECT 
                    c.consultation_id,
                    c.appointment_id,
                    c.doctor_id,
                    c.blood_pressure,
                    c.temperature,
                    c.oxygen_saturation,
                    c.diagnosis,
                    FORMAT(c.consultation_date, 'yyyy-MM-dd HH:mm:ss') AS consultation_date,
                    FORMAT(a.appointment_date, 'yyyy-MM-dd') AS appointment_date,
                    ts.start_time,
                    ts.end_time,
                    CONCAT(d.first_name, ' ', d.last_name) AS doctor_name,
                    s.specialization_name
                FROM consultations c
                INNER JOIN appointments a ON c.appointment_id = a.appointment_id
                INNER JOIN doctors d ON c.doctor_id = d.doctor_id
                INNER JOIN specializations s ON d.specialization_id = s.specialization_id
                LEFT JOIN time_slots ts ON a.slot_id = ts.slot_id
                WHERE c.patient_id = @patient_id
                ORDER BY c.consultation_date DESC
            `);

        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching patient consultations:', err);
        res.status(500).json({ error: 'Error fetching consultations' });
    }
});

// GET PATIENT'S PRESCRIBED MEDICINES
app.get('/api/patients/:patientId/prescriptions', async (req, res) => {
    try {
        const patientId = parseInt(req.params.patientId, 10);
        
        const result = await pool.request()
            .input('patient_id', sql.Int, patientId)
            .query(`
                SELECT 
                    pm.medicine_id,
                    pm.consultation_id,
                    pm.medicine_name,
                    pm.dosage,
                    pm.frequency,
                    pm.duration,
                    FORMAT(c.consultation_date, 'yyyy-MM-dd') AS consultation_date,
                    CONCAT(d.first_name, ' ', d.last_name) AS doctor_name
                FROM prescribed_medicines pm
                INNER JOIN consultations c ON pm.consultation_id = c.consultation_id
                INNER JOIN doctors d ON c.doctor_id = d.doctor_id
                WHERE c.patient_id = @patient_id
                ORDER BY c.consultation_date DESC, pm.medicine_id
            `);

        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching patient prescriptions:', err);
        res.status(500).json({ error: 'Error fetching prescriptions' });
    }
});

// GIVES ONLY SCHEDULED APPOINTMENTS FOR A DOCTOR (status_id = 1)
app.get('/api/doctors/:doctorId/appointments', async (req, res) => {
    try {
        const { doctorId } = req.params;
        const { start_date, end_date } = req.query;

        console.log(`📅 Fetching appointments for doctor ${doctorId}`);
        console.log(`   Date range: ${start_date || 'No start'} to ${end_date || 'No end'}`);
        
        let query = `
            SELECT 
                a.appointment_id,
                a.appointment_date,
                a.slot_id,
                a.status_id,
                a.created_at,
                -- FIX: Format the time as string instead of TIME type
                CONVERT(VARCHAR(8), ts.start_time, 108) as start_time,
                CONVERT(VARCHAR(8), ts.end_time, 108) as end_time,
                p.patient_id,
                p.first_name AS patient_first_name,
                p.last_name AS patient_last_name,
                p.phone_no,
                p.patient_login_id,
                s.status_name
            FROM appointments a
            INNER JOIN patients p ON a.patient_id = p.patient_id
            LEFT JOIN time_slots ts ON a.slot_id = ts.slot_id
            LEFT JOIN appointment_statuses s ON a.status_id = s.status_id
            WHERE a.doctor_id = @doctorId
            AND a.status_id = 1  -- ONLY SCHEDULED APPOINTMENTS
        `;

        const request = pool.request();
        request.input('doctorId', sql.Int, doctorId);

        if (start_date) {
            query += ` AND a.appointment_date >= @start_date`;
            request.input('start_date', sql.Date, start_date);
        }

        if (end_date) {
            query += ` AND a.appointment_date <= @end_date`;
            request.input('end_date', sql.Date, end_date);
        }

        query += ` ORDER BY a.appointment_date ASC, ts.start_time ASC`;

        console.log(`   SQL Query: ${query.split('ORDER BY')[0]}...`);
        
        const result = await request.query(query);
        
        console.log(`✅ Found ${result.recordset.length} scheduled appointments for doctor ${doctorId}`);
        
        // Debug: Log each appointment's status
        result.recordset.forEach(appointment => {
            console.log(`   Appt #${appointment.appointment_id}: Status=${appointment.status_id} (${appointment.status_name})`);
        });

        res.json(result.recordset);

    } catch (error) {
        console.error('❌ Error fetching appointments:', error);
        res.status(500).json({ error: 'Failed to fetch appointments' });
    }
});

// GET APPOINTMENTS FOR A PATIENT
app.get('/api/appointments', async (req, res) => {
  try {
    const { patient_id } = req.query;

    if (!patient_id) {
      return res.status(400).json({ error: 'patient_id is required' });
    }

    const query = `
      SELECT 
        a.appointment_id,
        a.appointment_date,
        a.patient_id,
        a.doctor_id,
        a.slot_id,
        t.start_time,
        t.end_time,
        CONCAT(d.first_name, ' ', d.last_name) AS doctor_name,
        spec.specialization_name,
        d.consultation_fee,
        ast.status_name
      FROM appointments a
      LEFT JOIN doctors d 
        ON a.doctor_id = d.doctor_id
      LEFT JOIN time_slots t  
        ON a.slot_id = t.slot_id
      LEFT JOIN specializations spec 
        ON d.specialization_id = spec.specialization_id
      LEFT JOIN appointment_statuses ast
        ON a.status_id = ast.status_id
      WHERE a.patient_id = @patient_id
      AND a.appointment_date >= CAST(GETDATE() AS DATE)
      AND a.status_id != 3  -- Exclude cancelled appointments
      ORDER BY a.appointment_date, t.start_time
    `;

    const result = await pool.request()
      .input('patient_id', sql.Int, patient_id)
      .query(query);

    res.json(result.recordset);

  } catch (error) {
    console.error('Error fetching appointments:', error);
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
});


//reports generation
// 1. Daily Patient Report
app.get('/reports/daily-patients', async (req, res) => {
    try {
        const { date } = req.query;
        const reportDate = date ? new Date(date) : new Date();
        
        const query = `
            SELECT 
                p.patient_id,
                p.patient_login_id,
                p.first_name + ' ' + p.last_name as patient_name,
                p.age,
                p.gender,
                p.blood_group,
                p.phone_no,
                p.created_at as registration_date,
                COUNT(DISTINCT a.appointment_id) as total_appointments,
                COUNT(DISTINCT CASE WHEN a.appointment_date = @date THEN a.appointment_id END) as appointments_today,
                COUNT(DISTINCT ad.admission_id) as total_admissions,
                COUNT(DISTINCT CASE WHEN ad.admission_date >= @date THEN ad.admission_id END) as admissions_today
            FROM patients p
            LEFT JOIN appointments a ON p.patient_id = a.patient_id
            LEFT JOIN admissions ad ON p.patient_id = ad.patient_id
            WHERE CAST(p.created_at AS DATE) = @date
                OR a.appointment_date = @date
                OR CAST(ad.admission_date AS DATE) = @date
            GROUP BY 
                p.patient_id, p.patient_login_id, p.first_name, p.last_name, 
                p.age, p.gender, p.blood_group, p.phone_no, p.created_at
            ORDER BY p.created_at DESC
        `;
        
        const result = await sql.query(query, { date: reportDate.toISOString().split('T')[0] });
        
        const summary = {
            total_patients: result.recordset.length,
            new_patients: result.recordset.filter(p => 
                new Date(p.registration_date).toDateString() === reportDate.toDateString()
            ).length,
            appointments_today: result.recordset.reduce((sum, p) => sum + (p.appointments_today || 0), 0),
            admissions_today: result.recordset.reduce((sum, p) => sum + (p.admissions_today || 0), 0),
            date: reportDate.toISOString().split('T')[0]
        };
        
        res.json({
            summary,
            data: result.recordset
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 2. Daily Doctor Report
app.get('/reports/daily-doctors', async (req, res) => {
    try {
        const { date } = req.query;
        const reportDate = date ? new Date(date) : new Date();
        
        const query = `
            SELECT 
                d.doctor_id,
                d.doctor_login_id,
                d.first_name + ' ' + d.last_name as doctor_name,
                s.specialization_name,
                d.consultation_fee,
                d.phone_no,
                d.experience_years,
                COUNT(DISTINCT a.appointment_id) as total_appointments_today,
                COUNT(DISTINCT c.consultation_id) as consultations_today,
                COUNT(DISTINCT apv.visit_id) as patient_visits_today,
                SUM(CASE WHEN a.status_id = 2 THEN d.consultation_fee ELSE 0 END) as revenue_today
            FROM doctors d
            JOIN specializations s ON d.specialization_id = s.specialization_id
            LEFT JOIN appointments a ON d.doctor_id = a.doctor_id 
                AND a.appointment_date = @date
                AND a.status_id != 3
            LEFT JOIN consultations c ON a.appointment_id = c.appointment_id
                AND CAST(c.consultation_date AS DATE) = @date
            LEFT JOIN admitted_patient_visits apv ON d.doctor_id = apv.doctor_id
                AND CAST(apv.visit_datetime AS DATE) = @date
            GROUP BY 
                d.doctor_id, d.doctor_login_id, d.first_name, d.last_name,
                s.specialization_name, d.consultation_fee, d.phone_no, d.experience_years
            ORDER BY revenue_today DESC
        `;
        
        const result = await sql.query(query, { date: reportDate.toISOString().split('T')[0] });
        
        const summary = {
            total_doctors: result.recordset.length,
            total_appointments: result.recordset.reduce((sum, d) => sum + (d.total_appointments_today || 0), 0),
            total_revenue: result.recordset.reduce((sum, d) => sum + (d.revenue_today || 0), 0),
            date: reportDate.toISOString().split('T')[0]
        };
        
        res.json({
            summary,
            data: result.recordset
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 3. Patient Reports in Range
app.get('/reports/patients-range', async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        
        const query = `
            SELECT 
                p.patient_id,
                p.patient_login_id,
                p.first_name + ' ' + p.last_name as patient_name,
                p.age,
                p.gender,
                p.blood_group,
                p.phone_no,
                p.created_at as registration_date,
                COUNT(DISTINCT a.appointment_id) as total_appointments,
                COUNT(DISTINCT c.consultation_id) as total_consultations,
                COUNT(DISTINCT ad.admission_id) as total_admissions,
                COUNT(DISTINCT d.discharge_id) as total_discharges,
                MIN(a.appointment_date) as first_appointment_date,
                MAX(a.appointment_date) as last_appointment_date,
                SUM(CASE WHEN a.status_id = 2 THEN doc.consultation_fee ELSE 0 END) as total_spent
            FROM patients p
            LEFT JOIN appointments a ON p.patient_id = a.patient_id
            LEFT JOIN consultations c ON a.appointment_id = c.appointment_id
            LEFT JOIN admissions ad ON p.patient_id = ad.patient_id
            LEFT JOIN discharges d ON ad.admission_id = d.admission_id
            LEFT JOIN doctors doc ON a.doctor_id = doc.doctor_id
            WHERE p.created_at BETWEEN @start_date AND @end_date
                OR a.appointment_date BETWEEN @start_date AND @end_date
                OR ad.admission_date BETWEEN @start_date AND @end_date
            GROUP BY 
                p.patient_id, p.patient_login_id, p.first_name, p.last_name,
                p.age, p.gender, p.blood_group, p.phone_no, p.created_at
            ORDER BY p.created_at DESC
        `;
        
        const result = await sql.query(query, {
            start_date,
            end_date: end_date + ' 23:59:59'
        });
        
        const summary = {
            total_patients: result.recordset.length,
            new_registrations: result.recordset.filter(p => 
                new Date(p.registration_date) >= new Date(start_date) &&
                new Date(p.registration_date) <= new Date(end_date)
            ).length,
            total_appointments: result.recordset.reduce((sum, p) => sum + (p.total_appointments || 0), 0),
            total_admissions: result.recordset.reduce((sum, p) => sum + (p.total_admissions || 0), 0),
            total_revenue: result.recordset.reduce((sum, p) => sum + (p.total_spent || 0), 0),
            period: `${start_date} to ${end_date}`
        };
        
        res.json({
            summary,
            data: result.recordset
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 4. Doctor Reports in Range
app.get('/reports/doctors-range', async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        
        const query = `
            SELECT 
                d.doctor_id,
                d.doctor_login_id,
                d.first_name + ' ' + d.last_name as doctor_name,
                s.specialization_name,
                d.consultation_fee,
                d.experience_years,
                d.registration_number,
                COUNT(DISTINCT a.appointment_id) as total_appointments,
                COUNT(DISTINCT CASE WHEN a.status_id = 2 THEN a.appointment_id END) as completed_appointments,
                COUNT(DISTINCT CASE WHEN a.status_id = 1 THEN a.appointment_id END) as scheduled_appointments,
                COUNT(DISTINCT CASE WHEN a.status_id = 3 THEN a.appointment_id END) as cancelled_appointments,
                COUNT(DISTINCT c.consultation_id) as total_consultations,
                COUNT(DISTINCT apv.visit_id) as patient_visits,
                COUNT(DISTINCT ad.admission_id) as admissions_recommended,
                SUM(CASE WHEN a.status_id = 2 THEN d.consultation_fee ELSE 0 END) as total_revenue,
                AVG(CASE WHEN a.status_id = 2 THEN 1.0 ELSE 0.0 END) * 100 as completion_rate
            FROM doctors d
            JOIN specializations s ON d.specialization_id = s.specialization_id
            LEFT JOIN appointments a ON d.doctor_id = a.doctor_id
                AND a.appointment_date BETWEEN @start_date AND @end_date
            LEFT JOIN consultations c ON a.appointment_id = c.appointment_id
            LEFT JOIN admitted_patient_visits apv ON d.doctor_id = apv.doctor_id
                AND apv.visit_datetime BETWEEN @start_date AND @end_date
            LEFT JOIN admissions ad ON d.doctor_id = ad.doctor_id
                AND ad.admission_date BETWEEN @start_date AND @end_date
            GROUP BY 
                d.doctor_id, d.doctor_login_id, d.first_name, d.last_name,
                s.specialization_name, d.consultation_fee, d.experience_years, d.registration_number
            ORDER BY total_revenue DESC
        `;
        
        const result = await sql.query(query, {
            start_date,
            end_date: end_date + ' 23:59:59'
        });
        
        const summary = {
            total_doctors: result.recordset.length,
            total_appointments: result.recordset.reduce((sum, d) => sum + (d.total_appointments || 0), 0),
            total_revenue: result.recordset.reduce((sum, d) => sum + (d.total_revenue || 0), 0),
            average_completion_rate: result.recordset.length > 0 ? 
                result.recordset.reduce((sum, d) => sum + (d.completion_rate || 0), 0) / result.recordset.length : 0,
            period: `${start_date} to ${end_date}`
        };
        
        res.json({
            summary,
            data: result.recordset
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// ============================================
// ADD THESE MISSING ENDPOINTS TO YOUR SERVER
// ============================================

// GET CONSULTATION ACTIONS FOR ADMISSION
app.get('/api/consultation-actions/admission-recommended', async (req, res) => {
  try {
    console.log('🔄 Fetching admission recommendations...');
    
    const result = await pool.request().query(`
      SELECT 
        ca.action_id,
        ca.consultation_id,
        ca.notes,
        ca.created_at,
        ca.status,
        at.action_name,
        
        -- Patient info
        c.patient_id,
        p.first_name AS patient_first_name,
        p.last_name AS patient_last_name,
        p.patient_login_id,
        p.gender AS patient_gender,
        
        -- Doctor info
        c.doctor_id,
        d.first_name AS doctor_first_name,
        d.last_name AS doctor_last_name,
        d.doctor_login_id,
        d.specialization_id AS doctor_specialization_id,
        s.specialization_name AS doctor_specialization_name,
        
        -- Consultation info
        c.appointment_id,
        FORMAT(c.consultation_date, 'yyyy-MM-dd HH:mm:ss') AS consultation_date
        
      FROM consultation_actions ca
      INNER JOIN action_types at ON ca.action_type_id = at.action_type_id
      INNER JOIN consultations c ON ca.consultation_id = c.consultation_id
      INNER JOIN patients p ON c.patient_id = p.patient_id
      INNER JOIN doctors d ON c.doctor_id = d.doctor_id
      INNER JOIN specializations s ON d.specialization_id = s.specialization_id
      WHERE at.action_name = 'Admit'
        AND ca.status = 'Pending'
        AND NOT EXISTS (
          SELECT 1 FROM admissions a 
          WHERE a.consultation_id = c.consultation_id 
          AND a.is_active = 1
        )
      ORDER BY ca.created_at DESC
    `);
    
    console.log(`✅ Found ${result.recordset.length} admission recommendations`);
    res.json(result.recordset);
  } catch (err) {
    console.error('❌ Error fetching admission recommendations:', err);
    res.status(500).json({ error: 'Error fetching admission recommendations' });
  }
});

// UPDATE ROOM OCCUPIED STATUS WHEN ADMITTED
app.put('/api/rooms/:roomId/occupied', async (req, res) => {
  try {
    const roomId = parseInt(req.params.roomId, 10);
    const { is_occupied } = req.body;

    await pool.request()
      .input('room_id', sql.Int, roomId)
      .input('is_occupied', sql.Bit, is_occupied ? 1 : 0)
      .query('UPDATE rooms SET is_occupied = @is_occupied WHERE room_id = @room_id');

    res.json({ message: 'Room status updated successfully' });
  } catch (err) {
    console.error('Error updating room status:', err);
    res.status(500).json({ error: 'Error updating room status' });
  }
});

// DISCHARGE ADMISSION
app.post('/api/admissions/discharge', async (req, res) => {
  const transaction = new sql.Transaction(pool);
  
  try {
    const {
      admission_id,
      discharge_date,
      final_bill_amount,
      discharge_notes,
      discharged_by_receptionist_id
    } = req.body;

    if (!admission_id || !final_bill_amount) {
      return res.status(400).json({ error: 'admission_id and final_bill_amount are required' });
    }

    await transaction.begin();
    const trRequest = new sql.Request(transaction);

    // Get admission details
    const admissionResult = await trRequest
      .input('admission_id', sql.Int, admission_id)
      .query(`
        SELECT a.*, r.room_id 
        FROM admissions a
        INNER JOIN rooms r ON a.initial_room_id = r.room_id
        WHERE a.admission_id = @admission_id AND a.is_active = 1
      `);

    if (admissionResult.recordset.length === 0) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Active admission not found' });
    }

    const admission = admissionResult.recordset[0];
    const roomId = admission.initial_room_id; // Corrected to use initial_room_id
    const totalDays = Math.ceil((new Date() - new Date(admission.admission_date)) / (1000 * 60 * 60 * 24));

    // Create discharge record
    await trRequest
      .input('admission_id', sql.Int, admission_id)
      .input('patient_id', sql.Int, admission.patient_id)
      .input('doctor_id', sql.Int, admission.doctor_id)
      .input('total_days', sql.Int, totalDays)
      .input('room_charges', sql.Decimal(10, 2), 0) // Calculate based on room type
      .input('medical_charges', sql.Decimal(10, 2), final_bill_amount)
      .input('total_amount', sql.Decimal(10, 2), final_bill_amount)
      .input('discharge_notes', sql.VarChar, discharge_notes || null)
      .input('processed_by_receptionist_id', sql.Int, discharged_by_receptionist_id)
      .query(`
        INSERT INTO discharges (
          admission_id, patient_id, doctor_id, total_days,
          room_charges, medical_charges, total_amount,
          discharge_notes, processed_by_receptionist_id
        ) VALUES (
          @admission_id, @patient_id, @doctor_id, @total_days,
          @room_charges, @medical_charges, @total_amount,
          @discharge_notes, @processed_by_receptionist_id
        )
      `);

    // Update admission as inactive
    await trRequest
      .input('admission_id', sql.Int, admission_id)
      .query('UPDATE admissions SET is_active = 0, discharge_date = GETDATE() WHERE admission_id = @admission_id');
      
    // Free up the bed and room
    await trRequest
      .input('bed_id', sql.Int, admission.bed_id)
      .query('UPDATE beds SET is_occupied = 0 WHERE bed_id = @bed_id');

    await trRequest
      .input('room_id', sql.Int, roomId)
      .query('UPDATE rooms SET is_occupied = 0 WHERE room_id = @room_id');

    await transaction.commit();
    res.json({ message: 'Patient discharged successfully' });

  } catch (err) {
    await transaction.rollback();
    console.error('Error discharging patient:', err);
    res.status(500).json({ error: 'Error discharging patient' });
  }
});




// GET BEDS
app.get('/api/beds', async (req, res) => {
  try {
    const result = await pool.request().query(`
      SELECT b.*, r.room_number, rt.type_name
      FROM beds b
      INNER JOIN rooms r ON b.room_id = r.room_id
      INNER JOIN room_types rt ON r.room_type_id = rt.room_type_id
      ORDER BY r.room_number, b.bed_number
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching beds:', err);
    res.status(500).json({ error: 'Error fetching beds' });
  }
});

// UPDATE BED OCCUPANCY
app.put('/api/beds/:bedId/occupy', async (req, res) => {
  try {
    const bedId = parseInt(req.params.bedId, 10);
    const { is_occupied } = req.body;

    await pool.request()
      .input('bed_id', sql.Int, bedId)
      .input('is_occupied', sql.Bit, is_occupied ? 1 : 0)
      .query('UPDATE beds SET is_occupied = @is_occupied WHERE bed_id = @bed_id');

    // Update corresponding room occupancy if all beds are occupied
    if (is_occupied) {
      await pool.request()
        .input('bed_id', sql.Int, bedId)
        .query(`
          UPDATE rooms 
          SET is_occupied = 1
          WHERE room_id = (
            SELECT room_id FROM beds WHERE bed_id = @bed_id
          )
          AND NOT EXISTS (
            SELECT 1 FROM beds b2 
            WHERE b2.room_id = rooms.room_id 
            AND b2.is_occupied = 0
          )
        `);
    }

    res.json({ message: 'Bed status updated successfully' });
  } catch (err) {
    console.error('Error updating bed status:', err);
    res.status(500).json({ error: 'Error updating bed status' });
  }
});

// UPDATE the admission consultation action to include gender and specialization
// In your existing consultation-actions endpoint, modify the query to include:




// ============================================
// ROOM & BED ENDPOINTS
// ============================================

// GET ALL ROOMS
app.get('/api/rooms', async (req, res) => {
    try {
        const result = await pool.request().query(`
            SELECT 
                r.room_id,
                r.room_number,
                r.room_type_id,
                rt.type_name,
                rt.description,
                rt.per_day_charges,
                r.floor_number,
                r.is_occupied,
                COUNT(b.bed_id) as total_beds,
                SUM(CASE WHEN b.is_occupied = 1 THEN 1 ELSE 0 END) as occupied_beds
            FROM rooms r
            INNER JOIN room_types rt ON r.room_type_id = rt.room_type_id
            LEFT JOIN beds b ON r.room_id = b.room_id
            GROUP BY 
                r.room_id, r.room_number, r.room_type_id, 
                rt.type_name, rt.description, rt.per_day_charges,
                r.floor_number, r.is_occupied
            ORDER BY r.floor_number, r.room_number
        `);
        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching rooms:', err);
        res.status(500).json({ error: 'Error fetching rooms' });
    }
});

// GET ALL BEDS
app.get('/api/beds', async (req, res) => {
    try {
        const result = await pool.request().query(`
            SELECT 
                b.bed_id,
                b.bed_code,
                b.room_id,
                b.bed_number,
                b.is_occupied,
                r.room_number,
                rt.type_name
            FROM beds b
            INNER JOIN rooms r ON b.room_id = r.room_id
            INNER JOIN room_types rt ON r.room_type_id = rt.room_type_id
            ORDER BY r.room_number, b.bed_number
        `);
        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching beds:', err);
        res.status(500).json({ error: 'Error fetching beds' });
    }
});

// OCCUPY BED
app.put('/api/beds/:bedId/occupy', async (req, res) => {
    try {
        const bedId = parseInt(req.params.bedId, 10);
        const { is_occupied } = req.body;

        // Update bed status
        await pool.request()
            .input('bed_id', sql.Int, bedId)
            .input('is_occupied', sql.Bit, is_occupied ? 1 : 0)
            .query('UPDATE beds SET is_occupied = @is_occupied WHERE bed_id = @bed_id');

        // Update room occupancy if all beds are occupied/vacated
        await pool.request()
            .input('bed_id', sql.Int, bedId)
            .query(`
                -- Get room_id for this bed
                DECLARE @room_id INT;
                SELECT @room_id = room_id FROM beds WHERE bed_id = @bed_id;

                -- Check if all beds in room are occupied
                DECLARE @all_occupied BIT;
                SELECT @all_occupied = CASE 
                    WHEN COUNT(*) = SUM(CASE WHEN is_occupied = 1 THEN 1 ELSE 0 END) THEN 1
                    ELSE 0
                END
                FROM beds WHERE room_id = @room_id;

                -- Update room occupancy
                UPDATE rooms SET is_occupied = @all_occupied WHERE room_id = @room_id;
            `);

        res.json({ message: 'Bed status updated successfully' });
    } catch (err) {
        console.error('Error updating bed status:', err);
        res.status(500).json({ error: 'Error updating bed status' });
    }
});

// GET ROOM TYPES
app.get('/api/room-types', async (req, res) => {
    try {
        const result = await pool.request().query(`
            SELECT * FROM room_types ORDER BY type_name
        `);
        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching room types:', err);
        res.status(500).json({ error: 'Error fetching room types' });
    }
});

// GET ACTIVE ADMISSIONS WITH BED INFO
app.get('/api/admissions/active', async (req, res) => {
    try {
        const result = await pool.request().query(`
            SELECT 
                a.admission_id,
                a.patient_id,
                a.doctor_id,
                a.consultation_id,
                a.action_id,
                a.initial_room_id,
                a.bed_id,
                a.admission_date,
                a.discharge_date,
                a.is_active,
                a.admission_notes,
                a.assigned_by_receptionist_id,
                
                -- Patient info
                CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
                p.age,
                p.gender,
                p.blood_group,
                p.phone_no,
                
                -- Doctor info
                CONCAT(d.first_name, ' ', d.last_name) AS doctor_name,
                d.specialization_id,
                
                -- Room info
                r.room_number,
                rt.type_name AS room_type,
                rt.per_day_charges,
                
                -- Bed info
                b.bed_number,
                b.bed_code,
                
                -- Receptionist info
                CONCAT(rec.first_name, ' ', rec.last_name) AS receptionist_name,
                
                -- Calculated fields
                DATEDIFF(DAY, a.admission_date, GETDATE()) AS days_admitted
                
            FROM admissions a
            INNER JOIN patients p ON a.patient_id = p.patient_id
            INNER JOIN doctors d ON a.doctor_id = d.doctor_id
            INNER JOIN rooms r ON a.initial_room_id = r.room_id
            INNER JOIN room_types rt ON r.room_type_id = rt.room_type_id
            INNER JOIN beds b ON a.bed_id = b.bed_id
            INNER JOIN receptionists rec ON a.assigned_by_receptionist_id = rec.receptionist_id
            WHERE a.is_active = 1
            ORDER BY a.admission_date DESC
        `);
        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching active admissions:', err);
        res.status(500).json({ error: 'Error fetching active admissions' });
    }
});

// GET SPECIALIZATIONS
app.get('/api/specializations', async (req, res) => {
    try {
        const result = await pool.request().query(`
            SELECT * FROM specializations ORDER BY specialization_name
        `);
        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching specializations:', err);
        res.status(500).json({ error: 'Error fetching specializations' });
    }
});

// GET AVAILABLE ROOMS (optional)
app.get('/api/rooms/available', async (req, res) => {
    try {
        const { room_type_id } = req.query;
        
        let query = `
            SELECT r.*, rt.type_name, rt.per_day_charges
            FROM rooms r
            INNER JOIN room_types rt ON r.room_type_id = rt.room_type_id
            WHERE r.is_occupied = 0
            AND EXISTS (
                SELECT 1 FROM beds b 
                WHERE b.room_id = r.room_id 
                AND b.is_occupied = 0
            )
        `;
        
        const request = pool.request();
        
        if (room_type_id) {
            query += ' AND r.room_type_id = @room_type_id';
            request.input('room_type_id', sql.Int, room_type_id);
        }
        
        query += ' ORDER BY r.floor_number, r.room_number';
        
        const result = await request.query(query);
        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching available rooms:', err);
        res.status(500).json({ error: 'Error fetching available rooms' });
    }
});

app.get('/api/consultation-actions/admission-recommended', async (req, res) => {
  try {
    console.log('🔄 Fetching admission recommendations...');
    
    const result = await pool.request().query(`
      SELECT 
        ca.action_id,
        ca.consultation_id,
        ca.notes,
        ca.created_at,
        ca.status,
        at.action_name,
        
        -- Patient info
        c.patient_id,
        p.first_name AS patient_first_name,
        p.last_name AS patient_last_name,
        p.patient_login_id,
        p.gender AS patient_gender,
        
        -- Doctor info
        c.doctor_id,
        d.first_name AS doctor_first_name,
        d.last_name AS doctor_last_name,
        d.doctor_login_id,
        d.specialization_id AS doctor_specialization_id,
        s.specialization_name AS doctor_specialization_name,
        
        -- Consultation info
        c.appointment_id,
        FORMAT(c.consultation_date, 'yyyy-MM-dd HH:mm:ss') AS consultation_date
        
      FROM consultation_actions ca
      INNER JOIN action_types at ON ca.action_type_id = at.action_type_id
      INNER JOIN consultations c ON ca.consultation_id = c.consultation_id
      INNER JOIN patients p ON c.patient_id = p.patient_id
      INNER JOIN doctors d ON c.doctor_id = d.doctor_id
      INNER JOIN specializations s ON d.specialization_id = s.specialization_id
      WHERE at.action_name = 'Admit'
        AND ca.status = 'Pending'
        AND NOT EXISTS (
          SELECT 1 FROM admissions a 
          WHERE a.consultation_id = c.consultation_id 
          AND a.is_active = 1
        )
      ORDER BY ca.created_at DESC
    `);
    
    console.log(`✅ Found ${result.recordset.length} admission recommendations`);
    res.json(result.recordset);
  } catch (err) {
    console.error('❌ Error fetching admission recommendations:', err);
    res.status(500).json({ error: 'Error fetching admission recommendations' });
  }
});

// 3. NEW: Get available beds by specialization and gender
app.get('/api/beds/available-filtered', async (req, res) => {
  try {
    const { specialization_name, patient_gender } = req.query;
    
    let query = `
      SELECT 
        b.bed_id,
        b.bed_code,
        b.room_id,
        b.bed_number,
        b.is_occupied,
        r.room_number,
        rt.type_name,
        rt.per_day_charges,
        r.floor_number
      FROM beds b
      INNER JOIN rooms r ON b.room_id = r.room_id
      INNER JOIN room_types rt ON r.room_type_id = rt.room_type_id
      WHERE b.is_occupied = 0
    `;
    
    // Filter by gender-specific wards
    if (patient_gender && (patient_gender.toLowerCase() === 'male' || patient_gender.toLowerCase() === 'female')) {
      const genderSuffix = patient_gender.toLowerCase() === 'male' ? '-M' : '-F';
      query += ` AND (rt.type_name LIKE '%${genderSuffix}%' OR rt.type_name NOT LIKE '%-M%' AND rt.type_name NOT LIKE '%-F%')`;
    }
    
    // Filter by specialization
    if (specialization_name) {
      const specPrefix = specialization_name.substring(0, 4).toUpperCase();
      query += ` AND (rt.type_name LIKE '%${specPrefix}%' OR rt.type_name LIKE '%GENERAL%')`;
    }
    
    query += ' ORDER BY r.floor_number, b.room_id, b.bed_number';
    
    const result = await pool.request().query(query);
    res.json(result.recordset);
    
  } catch (err) {
    console.error('Error fetching filtered beds:', err);
    res.status(500).json({ error: 'Error fetching beds' });
  }
});

// 4. NEW: Debug endpoint to check bed assignment
app.get('/api/debug/admission-status/:actionId', async (req, res) => {
  try {
    const actionId = parseInt(req.params.actionId, 10);
    
    const result = await pool.request()
      .input('action_id', sql.Int, actionId)
      .query(`
        SELECT 
          ca.action_id,
          ca.status,
          c.consultation_id,
          c.patient_id,
          c.doctor_id,
          p.first_name + ' ' + p.last_name as patient_name,
          d.first_name + ' ' + d.last_name as doctor_name,
          s.specialization_name,
          EXISTS(SELECT 1 FROM admissions WHERE consultation_id = c.consultation_id AND is_active = 1) as is_admitted
        FROM consultation_actions ca
        INNER JOIN consultations c ON ca.consultation_id = c.consultation_id
        INNER JOIN patients p ON c.patient_id = p.patient_id
        INNER JOIN doctors d ON c.doctor_id = d.doctor_id
        INNER JOIN specializations s ON d.specialization_id = s.specialization_id
        WHERE ca.action_id = @action_id
      `);
    
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Action not found' });
    }
    
    res.json(result.recordset[0]);
    
  } catch (err) {
    console.error('Error checking admission status:', err);
    res.status(500).json({ error: 'Error checking status' });
  }
});

// 5. NEW: Get active admissions with bed details (enhanced)
app.get('/api/admissions/active-detailed', async (req, res) => {
  try {
    const result = await pool.request().query(`
      SELECT 
        a.admission_id,
        a.patient_id,
        a.doctor_id,
        a.consultation_id,
        a.action_id,
        a.initial_room_id,
        a.bed_id,
        a.admission_date,
        a.discharge_date,
        a.is_active,
        a.admission_notes,
        a.assigned_by_receptionist_id,
        
        -- Patient info
        CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
        p.age,
        p.gender,
        p.blood_group,
        p.phone_no,
        
        -- Doctor info
        CONCAT(d.first_name, ' ', d.last_name) AS doctor_name,
        d.specialization_id,
        s.specialization_name,
        
        -- Room info
        r.room_number,
        rt.type_name AS room_type,
        rt.per_day_charges,
        
        -- Bed info
        b.bed_number,
        b.bed_code,
        
        -- Receptionist info
        CONCAT(rec.first_name, ' ', rec.last_name) AS receptionist_name,
        
        -- Calculated fields
        DATEDIFF(DAY, a.admission_date, GETDATE()) AS days_admitted
        
      FROM admissions a
      INNER JOIN patients p ON a.patient_id = p.patient_id
      INNER JOIN doctors d ON a.doctor_id = d.doctor_id
      INNER JOIN specializations s ON d.specialization_id = s.specialization_id
      INNER JOIN rooms r ON a.initial_room_id = r.room_id
      INNER JOIN room_types rt ON r.room_type_id = rt.room_type_id
      INNER JOIN beds b ON a.bed_id = b.bed_id
      INNER JOIN receptionists rec ON a.assigned_by_receptionist_id = rec.receptionist_id
      WHERE a.is_active = 1
      ORDER BY a.admission_date DESC
    `);
    
    res.json(result.recordset);
    
  } catch (err) {
    console.error('Error fetching detailed admissions:', err);
    res.status(500).json({ error: 'Error fetching admissions' });
  }
});

app.get('/api/debug/admission-check/:actionId', async (req, res) => {
    try {
        const actionId = parseInt(req.params.actionId, 10);
        
        const result = await pool.request()
            .input('action_id', sql.Int, actionId)
            .query(`
                SELECT 
                    ca.action_id,
                    ca.status,
                    ca.consultation_id,
                    c.patient_id,
                    c.doctor_id,
                    p.first_name + ' ' + p.last_name as patient_name,
                    d.first_name + ' ' + d.last_name as doctor_name,
                    s.specialization_name,
                    (SELECT COUNT(*) FROM admissions WHERE consultation_id = c.consultation_id AND is_active = 1) as existing_admission
                FROM consultation_actions ca
                INNER JOIN consultations c ON ca.consultation_id = c.consultation_id
                INNER JOIN patients p ON c.patient_id = p.patient_id
                INNER JOIN doctors d ON c.doctor_id = d.doctor_id
                INNER JOIN specializations s ON d.specialization_id = s.specialization_id
                WHERE ca.action_id = @action_id
            `);
        
        if (result.recordset.length === 0) {
            return res.status(404).json({ error: 'Action not found' });
        }
        
        // Also check bed availability
        const beds = await pool.request().query(`
            SELECT COUNT(*) as available_beds 
            FROM beds 
            WHERE is_occupied = 0
        `);
        
        res.json({
            action: result.recordset[0],
            bed_availability: beds.recordset[0],
            timestamp: new Date().toISOString()
        });
        
    } catch (err) {
        console.error('Error in debug endpoint:', err);
        res.status(500).json({ error: 'Debug failed', details: err.message });
    }
});



// ============================================
// DEBUG ENDPOINT TO CHECK ADMISSION DATA
// ============================================

// Test endpoint to check what data is received
app.post('/api/debug-admission', async (req, res) => {
  console.log('🔍 DEBUG ADMISSION - Request received:');
  console.log('📦 Full request body:', JSON.stringify(req.body, null, 2));
  
  // Check data types
  console.log('📊 Data types analysis:');
  Object.keys(req.body).forEach(key => {
    const value = req.body[key];
    console.log(`   ${key}: ${value} (type: ${typeof value}, isNaN: ${typeof value === 'number' ? isNaN(value) : 'N/A'})`);
  });
  
  // Try to parse all IDs
  console.log('🔄 ID parsing test:');
  const idsToCheck = ['patient_id', 'doctor_id', 'consultation_id', 'action_id', 'initial_room_id', 'bed_id', 'assigned_by_receptionist_id'];
  idsToCheck.forEach(key => {
    const value = req.body[key];
    const parsed = parseInt(value);
    console.log(`   ${key}: ${value} -> ${parsed} (valid: ${!isNaN(parsed) && parsed > 0})`);
  });
  
  res.json({
    success: true,
    message: 'Debug data received',
    data: req.body,
    analysis: {
      allIdsValid: idsToCheck.every(key => {
        const parsed = parseInt(req.body[key]);
        return !isNaN(parsed) && parsed > 0;
      })
    }
  });
});

// Simple test to check if endpoint is reachable
app.get('/api/test-connection', (req, res) => {
  res.json({ 
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    endpoints: ['/api/admissions', '/api/debug-admission', '/api/consultation-actions/admission-recommended']
  });
});


// ============================================
// ADMITTED PATIENT VISITS ROUTES
// ============================================

// NEW: Get admitted patients for a specific doctor
app.get('/api/doctors/:doctorId/admitted-patients', async (req, res) => {
  try {
    const doctorId = parseInt(req.params.doctorId, 10);
    
    console.log(`🩺 Fetching admitted patients for doctor ${doctorId}`);
    
    const result = await pool.request()
      .input('doctor_id', sql.Int, doctorId)
      .query(`
        SELECT 
          a.admission_id,
          a.patient_id,
          a.doctor_id,
          a.admission_date,
          a.admission_notes,
          a.is_active,
          -- Patient info
          p.first_name,
          p.last_name,
          p.age,
          p.gender,
          p.blood_group,
          p.phone_no,
          p.patient_login_id,
          -- Room info
          r.room_number,
          b.bed_number,
          b.bed_code,
          -- Consultation info
          c.consultation_date,
          -- Doctor info
          CONCAT(d.first_name, ' ', d.last_name) AS doctor_name,
          -- Days admitted
          DATEDIFF(DAY, a.admission_date, GETDATE()) AS days_admitted,
          -- Last visit info
          (SELECT TOP 1 condition_status 
           FROM admitted_patient_visits v 
           WHERE v.admission_id = a.admission_id 
           ORDER BY v.visit_datetime DESC) AS last_condition_status
        FROM admissions a
        INNER JOIN patients p ON a.patient_id = p.patient_id
        INNER JOIN doctors d ON a.doctor_id = d.doctor_id
        LEFT JOIN consultations c ON a.consultation_id = c.consultation_id
        LEFT JOIN rooms r ON a.initial_room_id = r.room_id
        LEFT JOIN beds b ON a.bed_id = b.bed_id
        WHERE a.doctor_id = @doctor_id
          AND a.is_active = 1
          AND a.discharge_date IS NULL
        ORDER BY a.admission_date DESC
      `);
    
    console.log(`✅ Found ${result.recordset.length} admitted patients for doctor ${doctorId}`);
    res.json(result.recordset);
    
  } catch (err) {
    console.error('❌ Error fetching admitted patients:', err);
    res.status(500).json({ 
      error: 'Error fetching admitted patients',
      details: err.message 
    });
  }
});

// NEW: Create patient visit for admitted patient (already exists but adding more context)
app.post('/api/patient-visits', async (req, res) => {
  try {
    console.log('🏥 Creating patient visit for admitted patient');
    console.log('📦 Request body:', JSON.stringify(req.body, null, 2));
    
    const {
      admission_id,
      patient_id,
      doctor_id,
      blood_pressure,
      temperature,
      oxygen_saturation,
      pulse_rate,
      condition_status,
      notes,
      treatment_given,
      ready_for_discharge,
      discharge_recommended_date
    } = req.body;

    // Validate required fields
    if (!admission_id || !patient_id || !doctor_id) {
      return res.status(400).json({ 
        error: 'admission_id, patient_id, and doctor_id are required' 
      });
    }

    // Check if admission exists and is active
    const admissionCheck = await pool.request()
      .input('admission_id', sql.Int, admission_id)
      .input('patient_id', sql.Int, patient_id)
      .input('doctor_id', sql.Int, doctor_id)
      .query(`
        SELECT a.admission_id, a.is_active
        FROM admissions a
        WHERE a.admission_id = @admission_id
          AND a.patient_id = @patient_id
          AND a.doctor_id = @doctor_id
          AND a.is_active = 1
      `);

    if (admissionCheck.recordset.length === 0) {
      return res.status(404).json({ 
        error: 'Active admission not found for the specified patient and doctor' 
      });
    }

    // Validate temperature range if provided
    if (temperature !== undefined && temperature !== null) {
      const temp = parseFloat(temperature);
      if (isNaN(temp) || temp < 90 || temp > 110) {
        return res.status(400).json({ 
          error: 'Temperature must be between 90 and 110°F' 
        });
      }
    }

    // Validate oxygen saturation if provided
    if (oxygen_saturation !== undefined && oxygen_saturation !== null) {
      const oxygen = parseInt(oxygen_saturation);
      if (isNaN(oxygen) || oxygen < 0 || oxygen > 100) {
        return res.status(400).json({ 
          error: 'Oxygen saturation must be between 0 and 100%' 
        });
      }
    }

    // Validate pulse rate if provided
    if (pulse_rate !== undefined && pulse_rate !== null) {
      const pulse = parseInt(pulse_rate);
      if (isNaN(pulse) || pulse < 0 || pulse > 300) {
        return res.status(400).json({ 
          error: 'Pulse rate must be between 0 and 300 BPM' 
        });
      }
    }

    // Validate condition status if provided
    const validConditions = ['Stable', 'Improving', 'Critical', 'Deteriorating'];
    if (condition_status && !validConditions.includes(condition_status)) {
      return res.status(400).json({ 
        error: 'Condition status must be one of: Stable, Improving, Critical, Deteriorating' 
      });
    }

    // Insert the patient visit
    const result = await pool.request()
      .input('admission_id', sql.Int, admission_id)
      .input('patient_id', sql.Int, patient_id)
      .input('doctor_id', sql.Int, doctor_id)
      .input('blood_pressure', sql.VarChar, blood_pressure || null)
      .input('temperature', sql.Decimal(4, 2), temperature || null)
      .input('oxygen_saturation', sql.Int, oxygen_saturation || null)
      .input('pulse_rate', sql.Int, pulse_rate || null)
      .input('condition_status', sql.VarChar, condition_status || null)
      .input('notes', sql.VarChar, notes || null)
      .input('treatment_given', sql.VarChar, treatment_given || null)
      .input('ready_for_discharge', sql.Bit, ready_for_discharge ? 1 : 0)
      .input('discharge_recommended_date', sql.DateTime, 
        discharge_recommended_date ? new Date(discharge_recommended_date) : null)
      .query(`
        INSERT INTO admitted_patient_visits (
          admission_id, patient_id, doctor_id, 
          blood_pressure, temperature, oxygen_saturation, pulse_rate,
          condition_status, notes, treatment_given,
          ready_for_discharge, discharge_recommended_date,
          visit_datetime
        )
        OUTPUT INSERTED.*
        VALUES (
          @admission_id, @patient_id, @doctor_id,
          @blood_pressure, @temperature, @oxygen_saturation, @pulse_rate,
          @condition_status, @notes, @treatment_given,
          @ready_for_discharge, @discharge_recommended_date,
          GETDATE()
        )
      `);

    const visit = result.recordset[0];
    console.log(`✅ Patient visit created: ID=${visit.visit_id}`);

    // If ready_for_discharge is true, update admission
    if (ready_for_discharge) {
      await pool.request()
        .input('admission_id', sql.Int, admission_id)
        .input('discharge_recommended_date', sql.DateTime, 
          discharge_recommended_date ? new Date(discharge_recommended_date) : null)
        .query(`
          UPDATE admissions 
          SET discharge_date = COALESCE(@discharge_recommended_date, GETDATE())
          WHERE admission_id = @admission_id
        `);
      
      console.log(`📝 Patient marked ready for discharge`);
    }

    res.status(201).json({
      message: ready_for_discharge 
        ? 'Patient visit recorded and patient marked ready for discharge'
        : 'Patient visit recorded successfully',
      visit: visit
    });

  } catch (err) {
    console.error('❌ Error creating patient visit:', err);
    res.status(500).json({ 
      error: 'Error creating patient visit',
      details: err.message 
    });
  }
});

// NEW: Get all visits for a specific admission
app.get('/api/admissions/:admissionId/visits', async (req, res) => {
  try {
    const admissionId = parseInt(req.params.admissionId, 10);
    
    const result = await pool.request()
      .input('admission_id', sql.Int, admissionId)
      .query(`
        SELECT 
          v.visit_id,
          v.admission_id,
          v.patient_id,
          v.doctor_id,
          v.blood_pressure,
          v.temperature,
          v.oxygen_saturation,
          v.pulse_rate,
          v.condition_status,
          v.notes,
          v.treatment_given,
          v.ready_for_discharge,
          v.discharge_recommended_date,
          v.visit_datetime,
          v.created_at,
          -- Patient info
          p.first_name AS patient_first_name,
          p.last_name AS patient_last_name,
          -- Doctor info
          CONCAT(d.first_name, ' ', d.last_name) AS doctor_name,
          -- Format dates
          FORMAT(v.visit_datetime, 'yyyy-MM-dd HH:mm') AS formatted_visit_date,
          FORMAT(v.discharge_recommended_date, 'yyyy-MM-dd') AS formatted_discharge_date
        FROM admitted_patient_visits v
        INNER JOIN patients p ON v.patient_id = p.patient_id
        INNER JOIN doctors d ON v.doctor_id = d.doctor_id
        WHERE v.admission_id = @admission_id
        ORDER BY v.visit_datetime DESC
      `);

    res.json(result.recordset);
    
  } catch (err) {
    console.error('Error fetching patient visits:', err);
    res.status(500).json({ error: 'Error fetching patient visits' });
  }
});

// NEW: Get recent visits for a doctor's patients
app.get('/api/doctors/:doctorId/recent-visits', async (req, res) => {
  try {
    const doctorId = parseInt(req.params.doctorId, 10);
    const limit = parseInt(req.query.limit) || 10;
    
    const result = await pool.request()
      .input('doctor_id', sql.Int, doctorId)
      .input('limit', sql.Int, limit)
      .query(`
        SELECT TOP (@limit)
          v.visit_id,
          v.admission_id,
          v.patient_id,
          v.blood_pressure,
          v.temperature,
          v.oxygen_saturation,
          v.pulse_rate,
          v.condition_status,
          v.ready_for_discharge,
          v.visit_datetime,
          -- Patient info
          CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
          p.gender,
          p.age,
          -- Room info
          r.room_number,
          b.bed_number,
          -- Format date
          FORMAT(v.visit_datetime, 'MMM dd, yyyy HH:mm') AS formatted_date
        FROM admitted_patient_visits v
        INNER JOIN patients p ON v.patient_id = p.patient_id
        INNER JOIN admissions a ON v.admission_id = a.admission_id
        LEFT JOIN rooms r ON a.initial_room_id = r.room_id
        LEFT JOIN beds b ON a.bed_id = b.bed_id
        WHERE v.doctor_id = @doctor_id
        ORDER BY v.visit_datetime DESC
      `);

    res.json(result.recordset);
    
  } catch (err) {
    console.error('Error fetching recent visits:', err);
    res.status(500).json({ error: 'Error fetching recent visits' });
  }
});

// NEW: Update a patient visit
app.put('/api/patient-visits/:visitId', async (req, res) => {
  try {
    const visitId = parseInt(req.params.visitId, 10);
    const {
      blood_pressure,
      temperature,
      oxygen_saturation,
      pulse_rate,
      condition_status,
      notes,
      treatment_given,
      ready_for_discharge,
      discharge_recommended_date
    } = req.body;

    // Build update query dynamically
    const updates = [];
    const request = pool.request().input('visit_id', sql.Int, visitId);

    if (blood_pressure !== undefined) {
      updates.push('blood_pressure = @blood_pressure');
      request.input('blood_pressure', sql.VarChar, blood_pressure);
    }
    
    if (temperature !== undefined) {
      updates.push('temperature = @temperature');
      request.input('temperature', sql.Decimal(4, 2), temperature);
    }
    
    if (oxygen_saturation !== undefined) {
      updates.push('oxygen_saturation = @oxygen_saturation');
      request.input('oxygen_saturation', sql.Int, oxygen_saturation);
    }
    
    if (pulse_rate !== undefined) {
      updates.push('pulse_rate = @pulse_rate');
      request.input('pulse_rate', sql.Int, pulse_rate);
    }
    
    if (condition_status !== undefined) {
      updates.push('condition_status = @condition_status');
      request.input('condition_status', sql.VarChar, condition_status);
    }
    
    if (notes !== undefined) {
      updates.push('notes = @notes');
      request.input('notes', sql.VarChar, notes);
    }
    
    if (treatment_given !== undefined) {
      updates.push('treatment_given = @treatment_given');
      request.input('treatment_given', sql.VarChar, treatment_given);
    }
    
    if (ready_for_discharge !== undefined) {
      updates.push('ready_for_discharge = @ready_for_discharge');
      request.input('ready_for_discharge', sql.Bit, ready_for_discharge ? 1 : 0);
    }
    
    if (discharge_recommended_date !== undefined) {
      updates.push('discharge_recommended_date = @discharge_recommended_date');
      request.input('discharge_recommended_date', sql.DateTime, 
        discharge_recommended_date ? new Date(discharge_recommended_date) : null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const query = `
      UPDATE admitted_patient_visits 
      SET ${updates.join(', ')}
      WHERE visit_id = @visit_id;
      
      SELECT * FROM admitted_patient_visits WHERE visit_id = @visit_id;
    `;

    const result = await request.query(query);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Visit not found' });
    }

    res.json({
      message: 'Visit updated successfully',
      visit: result.recordset[0]
    });

  } catch (err) {
    console.error('Error updating patient visit:', err);
    res.status(500).json({ error: 'Error updating patient visit' });
  }
});

// NEW: Get summary of visits for a doctor
app.get('/api/doctors/:doctorId/visits-summary', async (req, res) => {
  try {
    const doctorId = parseInt(req.params.doctorId, 10);
    const { days = 30 } = req.query;
    
    const result = await pool.request()
      .input('doctor_id', sql.Int, doctorId)
      .input('days', sql.Int, parseInt(days))
      .query(`
        SELECT 
          -- Total visits count
          COUNT(*) as total_visits,
          -- Visits by condition status
          SUM(CASE WHEN condition_status = 'Stable' THEN 1 ELSE 0 END) as stable_count,
          SUM(CASE WHEN condition_status = 'Improving' THEN 1 ELSE 0 END) as improving_count,
          SUM(CASE WHEN condition_status = 'Critical' THEN 1 ELSE 0 END) as critical_count,
          SUM(CASE WHEN condition_status = 'Deteriorating' THEN 1 ELSE 0 END) as deteriorating_count,
          -- Patients ready for discharge
          SUM(CASE WHEN ready_for_discharge = 1 THEN 1 ELSE 0 END) as ready_for_discharge_count,
          -- Average vitals
          AVG(CAST(temperature AS FLOAT)) as avg_temperature,
          AVG(CAST(oxygen_saturation AS FLOAT)) as avg_oxygen_saturation,
          AVG(CAST(pulse_rate AS FLOAT)) as avg_pulse_rate
        FROM admitted_patient_visits
        WHERE doctor_id = @doctor_id
          AND visit_datetime >= DATEADD(DAY, -@days, GETDATE())
      `);

    const summary = result.recordset[0];
    
    // Get daily visit trend
    const trendResult = await pool.request()
      .input('doctor_id', sql.Int, doctorId)
      .input('days', sql.Int, parseInt(days))
      .query(`
        SELECT 
          CAST(visit_datetime AS DATE) as visit_date,
          COUNT(*) as visit_count
        FROM admitted_patient_visits
        WHERE doctor_id = @doctor_id
          AND visit_datetime >= DATEADD(DAY, -@days, GETDATE())
        GROUP BY CAST(visit_datetime AS DATE)
        ORDER BY visit_date
      `);

    res.json({
      summary: summary,
      trend: trendResult.recordset,
      period_days: days
    });

  } catch (err) {
    console.error('Error fetching visits summary:', err);
    res.status(500).json({ error: 'Error fetching visits summary' });
  }
});

// ============================================
// DISCHARGED PATIENTS ROUTES
// ============================================

// NEW: Get discharged patients for a doctor
app.get('/api/doctors/:doctorId/discharged-patients', async (req, res) => {
  try {
    const doctorId = parseInt(req.params.doctorId, 10);
    const { start_date, end_date, limit = 50 } = req.query;
    
    let query = `
      SELECT 
        d.discharge_id,
        d.admission_id,
        d.patient_id,
        d.doctor_id,
        d.discharge_date,
        d.total_days,
        d.total_amount,
        d.payment_status,
        d.amount_paid,
        d.final_diagnosis,
        d.discharge_summary,
        d.follow_up_required,
        d.follow_up_date,
        -- Patient info
        CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
        p.age,
        p.gender,
        p.blood_group,
        p.phone_no,
        -- Room info at admission
        r.room_number,
        -- Doctor info
        CONCAT(doc.first_name, ' ', doc.last_name) AS doctor_name,
        doc.specialization_id,
        s.specialization_name,
        -- Days in hospital
        DATEDIFF(DAY, a.admission_date, d.discharge_date) AS hospital_days,
        -- Format dates
        FORMAT(d.discharge_date, 'yyyy-MM-dd') AS formatted_discharge_date,
        FORMAT(a.admission_date, 'yyyy-MM-dd') AS formatted_admission_date
      FROM discharges d
      INNER JOIN patients p ON d.patient_id = p.patient_id
      INNER JOIN doctors doc ON d.doctor_id = doc.doctor_id
      INNER JOIN specializations s ON doc.specialization_id = s.specialization_id
      INNER JOIN admissions a ON d.admission_id = a.admission_id
      LEFT JOIN rooms r ON a.initial_room_id = r.room_id
      WHERE d.doctor_id = @doctor_id
    `;
    
    const request = pool.request()
      .input('doctor_id', sql.Int, doctorId)
      .input('limit', sql.Int, parseInt(limit));
    
    if (start_date) {
      query += ' AND d.discharge_date >= @start_date';
      request.input('start_date', sql.Date, start_date);
    }
    
    if (end_date) {
      query += ' AND d.discharge_date <= @end_date';
      request.input('end_date', sql.Date, end_date);
    }
    
    query += ' ORDER BY d.discharge_date DESC';
    query += ' OFFSET 0 ROWS FETCH NEXT @limit ROWS ONLY';
    
    const result = await request.query(query);
    res.json(result.recordset);
    
  } catch (err) {
    console.error('Error fetching discharged patients:', err);
    res.status(500).json({ error: 'Error fetching discharged patients' });
  }
});

// NEW: Get discharge details with all visit history
app.get('/api/discharges/:dischargeId/details', async (req, res) => {
  try {
    const dischargeId = parseInt(req.params.dischargeId, 10);
    
    // Get discharge info
    const dischargeResult = await pool.request()
      .input('discharge_id', sql.Int, dischargeId)
      .query(`
        SELECT 
          d.*,
          CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
          p.age,
          p.gender,
          p.blood_group,
          p.phone_no,
          CONCAT(doc.first_name, ' ', doc.last_name) AS doctor_name,
          s.specialization_name,
          CONCAT(rec.first_name, ' ', rec.last_name) AS receptionist_name,
          FORMAT(d.discharge_date, 'dd MMM yyyy HH:mm') AS formatted_discharge_date
        FROM discharges d
        INNER JOIN patients p ON d.patient_id = p.patient_id
        INNER JOIN doctors doc ON d.doctor_id = doc.doctor_id
        INNER JOIN specializations s ON doc.specialization_id = s.specialization_id
        INNER JOIN receptionists rec ON d.processed_by_receptionist_id = rec.receptionist_id
        WHERE d.discharge_id = @discharge_id
      `);
    
    if (dischargeResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Discharge not found' });
    }
    
    const discharge = dischargeResult.recordset[0];
    
    // Get admission info
    const admissionResult = await pool.request()
      .input('admission_id', sql.Int, discharge.admission_id)
      .query(`
        SELECT 
          a.*,
          r.room_number,
          b.bed_number,
          b.bed_code,
          rt.type_name AS room_type,
          rt.per_day_charges,
          FORMAT(a.admission_date, 'dd MMM yyyy HH:mm') AS formatted_admission_date
        FROM admissions a
        LEFT JOIN rooms r ON a.initial_room_id = r.room_id
        LEFT JOIN beds b ON a.bed_id = b.bed_id
        LEFT JOIN room_types rt ON r.room_type_id = rt.room_type_id
        WHERE a.admission_id = @admission_id
      `);
    
    // Get all visits during admission
    const visitsResult = await pool.request()
      .input('admission_id', sql.Int, discharge.admission_id)
      .query(`
        SELECT 
          v.*,
          FORMAT(v.visit_datetime, 'dd MMM yyyy HH:mm') AS formatted_visit_date,
          FORMAT(v.discharge_recommended_date, 'dd MMM yyyy') AS formatted_recommended_discharge_date
        FROM admitted_patient_visits v
        WHERE v.admission_id = @admission_id
        ORDER BY v.visit_datetime
      `);
    
    res.json({
      discharge: discharge,
      admission: admissionResult.recordset[0] || null,
      visits: visitsResult.recordset
    });
    
  } catch (err) {
    console.error('Error fetching discharge details:', err);
    res.status(500).json({ error: 'Error fetching discharge details' });
  }
});

// NEW: Get discharge summary statistics for doctor
app.get('/api/doctors/:doctorId/discharge-stats', async (req, res) => {
  try {
    const doctorId = parseInt(req.params.doctorId, 10);
    const { period = 'month' } = req.query; // day, week, month, year
    
    const dateFilter = {
      'day': 'DATEADD(DAY, -1, GETDATE())',
      'week': 'DATEADD(WEEK, -1, GETDATE())',
      'month': 'DATEADD(MONTH, -1, GETDATE())',
      'year': 'DATEADD(YEAR, -1, GETDATE())'
    }[period] || 'DATEADD(MONTH, -1, GETDATE())';
    
    const result = await pool.request()
      .input('doctor_id', sql.Int, doctorId)
      .query(`
        SELECT 
          -- Counts
          COUNT(*) as total_discharges,
          SUM(CASE WHEN follow_up_required = 1 THEN 1 ELSE 0 END) as follow_up_required,
          -- Financial
          SUM(total_amount) as total_revenue,
          AVG(total_amount) as average_bill,
          -- Time metrics
          AVG(CAST(total_days AS FLOAT)) as avg_hospital_stay,
          -- Payment status
          SUM(CASE WHEN payment_status = 'Paid' THEN 1 ELSE 0 END) as paid_count,
          SUM(CASE WHEN payment_status = 'Unpaid' THEN 1 ELSE 0 END) as unpaid_count,
          SUM(CASE WHEN payment_status = 'Partial' THEN 1 ELSE 0 END) as partial_count,
          -- Amounts
          SUM(amount_paid) as total_paid,
          SUM(total_amount - amount_paid) as total_pending
        FROM discharges
        WHERE doctor_id = @doctor_id
          AND discharge_date >= ${dateFilter}
      `);
    
    res.json(result.recordset[0] || {});
    
  } catch (err) {
    console.error('Error fetching discharge stats:', err);
    res.status(500).json({ error: 'Error fetching discharge stats' });
  }
});

// NEW: Update discharge follow-up info
app.put('/api/discharges/:dischargeId/follow-up', async (req, res) => {
  try {
    const dischargeId = parseInt(req.params.dischargeId, 10);
    const { follow_up_required, follow_up_date, follow_up_notes } = req.body;
    
    const updates = [];
    const request = pool.request().input('discharge_id', sql.Int, dischargeId);
    
    if (follow_up_required !== undefined) {
      updates.push('follow_up_required = @follow_up_required');
      request.input('follow_up_required', sql.Bit, follow_up_required ? 1 : 0);
    }
    
    if (follow_up_date !== undefined) {
      updates.push('follow_up_date = @follow_up_date');
      request.input('follow_up_date', sql.Date, 
        follow_up_date ? new Date(follow_up_date) : null);
    }
    
    if (follow_up_notes !== undefined) {
      updates.push('discharge_instructions = @follow_up_notes');
      request.input('follow_up_notes', sql.VarChar, follow_up_notes);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    const query = `
      UPDATE discharges 
      SET ${updates.join(', ')}
      WHERE discharge_id = @discharge_id;
      
      SELECT * FROM discharges WHERE discharge_id = @discharge_id;
    `;
    
    const result = await request.query(query);
    
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Discharge not found' });
    }
    
    res.json({
      message: 'Follow-up information updated successfully',
      discharge: result.recordset[0]
    });
    
  } catch (err) {
    console.error('Error updating follow-up info:', err);
    res.status(500).json({ error: 'Error updating follow-up info' });
  }
});

// NEW: Search discharged patients
app.get('/api/discharges/search', async (req, res) => {
  try {
    const { query, doctor_id } = req.query;
    
    if (!query || query.trim().length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }
    
    const searchQuery = `%${query.trim()}%`;
    
    let sqlQuery = `
      SELECT 
        d.discharge_id,
        d.admission_id,
        d.patient_id,
        d.doctor_id,
        d.discharge_date,
        d.total_amount,
        d.payment_status,
        CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
        p.phone_no,
        CONCAT(doc.first_name, ' ', doc.last_name) AS doctor_name,
        s.specialization_name
      FROM discharges d
      INNER JOIN patients p ON d.patient_id = p.patient_id
      INNER JOIN doctors doc ON d.doctor_id = doc.doctor_id
      INNER JOIN specializations s ON doc.specialization_id = s.specialization_id
      WHERE (
        p.first_name LIKE @query 
        OR p.last_name LIKE @query 
        OR p.phone_no LIKE @query
        OR p.patient_login_id LIKE @query
        OR doc.first_name LIKE @query
        OR doc.last_name LIKE @query
        OR s.specialization_name LIKE @query
      )
    `;
    
    const request = pool.request()
      .input('query', sql.VarChar, searchQuery);
    
    if (doctor_id) {
      sqlQuery += ' AND d.doctor_id = @doctor_id';
      request.input('doctor_id', sql.Int, parseInt(doctor_id));
    }
    
    sqlQuery += ' ORDER BY d.discharge_date DESC';
    
    const result = await request.query(sqlQuery);
    res.json(result.recordset);
    
  } catch (err) {
    console.error('Error searching discharges:', err);
    res.status(500).json({ error: 'Error searching discharges' });
  }
});



// ============================================
// GET ALL VISITS FOR A SPECIFIC PATIENT (by admission)
// ============================================

app.get('/api/patients/:patientId/admitted-visits', async (req, res) => {
  try {
    const patientId = parseInt(req.params.patientId, 10);
    const { admission_id } = req.query;
    
    let query = `
      SELECT 
        v.visit_id,
        v.admission_id,
        v.patient_id,
        v.doctor_id,
        v.blood_pressure,
        v.temperature,
        v.oxygen_saturation,
        v.pulse_rate,
        v.condition_status,
        v.notes,
        v.treatment_given,
        v.ready_for_discharge,
        v.discharge_recommended_date,
        v.visit_datetime,
        v.created_at,
        -- Patient info
        CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
        p.age,
        p.gender,
        -- Doctor info
        CONCAT(d.first_name, ' ', d.last_name) AS doctor_name,
        d.specialization_id,
        s.specialization_name,
        -- Admission info
        a.admission_date,
        r.room_number,
        b.bed_number,
        -- Format dates
        FORMAT(v.visit_datetime, 'dd MMM yyyy, hh:mm tt') AS formatted_visit_date,
        FORMAT(v.visit_datetime, 'yyyy-MM-dd') AS visit_date_only,
        FORMAT(v.visit_datetime, 'HH:mm') AS visit_time_only,
        FORMAT(v.discharge_recommended_date, 'dd MMM yyyy') AS formatted_discharge_recommended_date,
        -- Days since admission
        DATEDIFF(DAY, a.admission_date, v.visit_datetime) AS days_since_admission
      FROM admitted_patient_visits v
      INNER JOIN patients p ON v.patient_id = p.patient_id
      INNER JOIN doctors d ON v.doctor_id = d.doctor_id
      INNER JOIN specializations s ON d.specialization_id = s.specialization_id
      INNER JOIN admissions a ON v.admission_id = a.admission_id
      LEFT JOIN rooms r ON a.initial_room_id = r.room_id
      LEFT JOIN beds b ON a.bed_id = b.bed_id
      WHERE v.patient_id = @patient_id
    `;
    
    const request = pool.request()
      .input('patient_id', sql.Int, patientId);
    
    if (admission_id) {
      query += ' AND v.admission_id = @admission_id';
      request.input('admission_id', sql.Int, admission_id);
    }
    
    query += ' ORDER BY v.visit_datetime DESC';
    
    const result = await request.query(query);
    
    console.log(`✅ Found ${result.recordset.length} visits for patient ${patientId}`);
    
    // Group visits by date for better UI display
    const visitsByDate = {};
    result.recordset.forEach(visit => {
      const dateKey = visit.visit_date_only;
      if (!visitsByDate[dateKey]) {
        visitsByDate[dateKey] = [];
      }
      visitsByDate[dateKey].push(visit);
    });
    
    res.json({
      total_visits: result.recordset.length,
      visits: result.recordset,
      visits_by_date: visitsByDate
    });
    
  } catch (err) {
    console.error('❌ Error fetching patient visits:', err);
    res.status(500).json({ 
      error: 'Error fetching patient visits',
      details: err.message 
    });
  }
});

// ============================================
// GET VISITS SUMMARY FOR PATIENT
// ============================================

app.get('/api/patients/:patientId/visits-summary', async (req, res) => {
  try {
    const patientId = parseInt(req.params.patientId, 10);
    
    const result = await pool.request()
      .input('patient_id', sql.Int, patientId)
      .query(`
        SELECT 
          -- Counts
          COUNT(*) as total_visits,
          -- Condition status breakdown
          SUM(CASE WHEN condition_status = 'Stable' THEN 1 ELSE 0 END) as stable_visits,
          SUM(CASE WHEN condition_status = 'Improving' THEN 1 ELSE 0 END) as improving_visits,
          SUM(CASE WHEN condition_status = 'Critical' THEN 1 ELSE 0 END) as critical_visits,
          SUM(CASE WHEN condition_status = 'Deteriorating' THEN 1 ELSE 0 END) as deteriorating_visits,
          -- Ready for discharge
          SUM(CASE WHEN ready_for_discharge = 1 THEN 1 ELSE 0 END) as ready_for_discharge_count,
          -- Averages
          AVG(CAST(temperature AS FLOAT)) as avg_temperature,
          AVG(CAST(oxygen_saturation AS FLOAT)) as avg_oxygen,
          AVG(CAST(pulse_rate AS FLOAT)) as avg_pulse,
          -- First and last visit
          MIN(visit_datetime) as first_visit_date,
          MAX(visit_datetime) as last_visit_date,
          -- Different doctors visited
          COUNT(DISTINCT doctor_id) as unique_doctors_count
        FROM admitted_patient_visits
        WHERE patient_id = @patient_id
      `);
    
    // Get doctors who visited
    const doctorsResult = await pool.request()
      .input('patient_id', sql.Int, patientId)
      .query(`
        SELECT DISTINCT 
          v.doctor_id,
          CONCAT(d.first_name, ' ', d.last_name) as doctor_name,
          s.specialization_name,
          COUNT(v.visit_id) as visits_by_doctor
        FROM admitted_patient_visits v
        INNER JOIN doctors d ON v.doctor_id = d.doctor_id
        INNER JOIN specializations s ON d.specialization_id = s.specialization_id
        WHERE v.patient_id = @patient_id
        GROUP BY v.doctor_id, d.first_name, d.last_name, s.specialization_name
      `);
    
    res.json({
      summary: result.recordset[0] || {},
      doctors: doctorsResult.recordset
    });
    
  } catch (err) {
    console.error('Error fetching visits summary:', err);
    res.status(500).json({ error: 'Error fetching visits summary' });
  }
});



// ============================================
app.get('/api/admissions/ready-for-discharge', async (req, res) => {
  try {
    console.log('🔄 Fetching patients ready for discharge...');
    
    const result = await pool.request().query(`
      WITH LatestVisits AS (
        SELECT 
          admission_id,
          MAX(visit_datetime) as latest_visit
        FROM admitted_patient_visits
        WHERE ready_for_discharge = 1
        GROUP BY admission_id
      )
      SELECT 
        a.admission_id,
        a.patient_id,
        a.doctor_id,
        a.bed_id,
        a.initial_room_id,
        a.admission_date,
        a.admission_notes,
        
        -- Patient info
        p.first_name AS patient_first_name,
        p.last_name AS patient_last_name,
        p.patient_login_id,
        p.age,
        p.gender,
        p.blood_group,
        p.phone_no,
        
        -- Doctor info
        d.first_name AS doctor_first_name,
        d.last_name AS doctor_last_name,
        d.doctor_login_id,
        d.specialization_id,
        s.specialization_name,
        
        -- Room info
        r.room_number,
        r.room_type_id,
        rt.type_name AS room_type,
        rt.per_day_charges,
        
        -- Bed info
        b.bed_number,
        b.bed_code,
        
        -- Latest visit with discharge recommendation
        v.visit_id,
        v.ready_for_discharge,
        v.discharge_recommended_date,
        v.condition_status,
        v.visit_datetime AS last_visit_date,
        v.treatment_given,
        v.notes AS doctor_notes,
        
        -- Admission days
        DATEDIFF(DAY, a.admission_date, GETDATE()) AS days_admitted
        
      FROM admissions a
      INNER JOIN patients p ON a.patient_id = p.patient_id
      INNER JOIN doctors d ON a.doctor_id = d.doctor_id
      INNER JOIN specializations s ON d.specialization_id = s.specialization_id
      INNER JOIN rooms r ON a.initial_room_id = r.room_id
      INNER JOIN room_types rt ON r.room_type_id = rt.room_type_id
      INNER JOIN beds b ON a.bed_id = b.bed_id
      INNER JOIN LatestVisits lv ON a.admission_id = lv.admission_id
      INNER JOIN admitted_patient_visits v ON a.admission_id = v.admission_id 
        AND v.visit_datetime = lv.latest_visit
      WHERE a.is_active = 1
        AND v.ready_for_discharge = 1
        AND NOT EXISTS (
          SELECT 1 FROM discharges dis 
          WHERE dis.admission_id = a.admission_id
        )
      ORDER BY v.discharge_recommended_date ASC, a.admission_date DESC
    `);
    
    console.log(`✅ Found ${result.recordset.length} patients ready for discharge`);
    
    // Debug: Show what we found
    if (result.recordset.length > 0) {
      console.log('📋 Patients ready for discharge:');
      result.recordset.forEach(patient => {
        console.log(`  - ${patient.patient_first_name} ${patient.patient_last_name} (Admission ID: ${patient.admission_id})`);
        console.log(`    Room: ${patient.room_number}, Bed: ${patient.bed_number}`);
        console.log(`    Ready for discharge since: ${patient.discharge_recommended_date}`);
        console.log(`    Condition: ${patient.condition_status}`);
      });
    } else {
      console.log('📭 No patients found ready for discharge');
      
      // Debug query to check what's in admitted_patient_visits
      const debugResult = await pool.request().query(`
        SELECT TOP 5 
          admission_id,
          ready_for_discharge,
          discharge_recommended_date,
          condition_status,
          visit_datetime
        FROM admitted_patient_visits
        WHERE ready_for_discharge = 1
        ORDER BY visit_datetime DESC
      `);
      
      console.log('🔍 Debug - Recent visits with ready_for_discharge = 1:');
      debugResult.recordset.forEach(visit => {
        console.log(`  - Admission ${visit.admission_id}: ${visit.discharge_recommended_date}, Status: ${visit.condition_status}`);
      });
    }
    
    res.json(result.recordset);
  } catch (err) {
    console.error('❌ Error fetching patients ready for discharge:', err);
    res.status(500).json({ 
      error: 'Error fetching patients ready for discharge',
      details: err.message 
    });
  }
});
// 2. GET DOCTOR FEES (MISSING)
app.get('/api/doctor-fees', async (req, res) => {
  try {
    const result = await pool.request().query(`
      SELECT 
        doctor_id,
        consultation_fee
      FROM doctors
      ORDER BY doctor_id
    `);
    
    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching doctor fees:', err);
    res.status(500).json({ error: 'Error fetching doctor fees' });
  }
});

// 3. GET ROOM CHARGES (MISSING)
app.get('/api/room-charges', async (req, res) => {
  try {
    const result = await pool.request().query(`
      SELECT 
        room_type_id,
        per_day_charges AS daily_charge
      FROM room_types
      ORDER BY room_type_id
    `);
    
    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching room charges:', err);
    res.status(500).json({ error: 'Error fetching room charges' });
  }
});
// 4. DISCHARGE PATIENT ENDPOINT (MISSING - Update admission endpoint)
app.put('/api/admissions/:admissionId/discharge', async (req, res) => {
  const transaction = new sql.Transaction(pool);
  
  try {
    const admissionId = parseInt(req.params.admissionId, 10);
    const {
      bed_id,
      total_bill,
      discharge_date,
      discharged_by_receptionist_id
    } = req.body;

    console.log(`🚀 Discharging admission ${admissionId}`);

    if (!bed_id || !total_bill || !discharged_by_receptionist_id) {
      return res.status(400).json({ 
        error: 'bed_id, total_bill, and discharged_by_receptionist_id are required' 
      });
    }

    // Validate input values
    if (isNaN(admissionId)) {
      return res.status(400).json({ error: 'Invalid admission ID' });
    }

    await transaction.begin();

    // 1. Get admission details
    const trRequest1 = new sql.Request(transaction);
    const admissionResult = await trRequest1
      .input('admission_id', sql.Int, admissionId)
      .query(`
        SELECT 
          a.*,
          p.patient_id,
          d.doctor_id,
          r.room_id,
          r.room_type_id
        FROM admissions a
        INNER JOIN patients p ON a.patient_id = p.patient_id
        INNER JOIN doctors d ON a.doctor_id = d.doctor_id
        INNER JOIN rooms r ON a.initial_room_id = r.room_id
        WHERE a.admission_id = @admission_id
          AND a.is_active = 1
      `);

    if (admissionResult.recordset.length === 0) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Active admission not found' });
    }

    const admission = admissionResult.recordset[0];
    
    // Debug log to check the admission data
    console.log('Admission data:', {
      patient_id: admission.patient_id,
      doctor_id: admission.doctor_id,
      room_id: admission.room_id,
      room_type_id: admission.room_type_id
    });

    // Validate that we have all required data
    if (!admission.patient_id || !admission.doctor_id || !admission.room_id || !admission.room_type_id) {
      await transaction.rollback();
      return res.status(400).json({ 
        error: 'Invalid admission data retrieved from database',
        details: {
          patient_id: admission.patient_id,
          doctor_id: admission.doctor_id,
          room_id: admission.room_id,
          room_type_id: admission.room_type_id
        }
      });
    }

    // Convert to integers to ensure they're valid numbers
    const patientId = parseInt(admission.patient_id, 10);
    const doctorId = parseInt(admission.doctor_id, 10);
    const roomId = parseInt(admission.room_id, 10);
    const roomTypeId = parseInt(admission.room_type_id, 10);

    if (isNaN(patientId) || isNaN(doctorId) || isNaN(roomId) || isNaN(roomTypeId)) {
      await transaction.rollback();
      return res.status(400).json({ 
        error: 'Invalid numeric values in admission data',
        details: {
          patient_id: patientId,
          doctor_id: doctorId,
          room_id: roomId,
          room_type_id: roomTypeId
        }
      });
    }
    
    // 2. Calculate days admitted
    const admissionDate = new Date(admission.admission_date);
    const dischargeDate = discharge_date ? new Date(discharge_date) : new Date();
    let totalDays = Math.ceil((dischargeDate - admissionDate) / (1000 * 60 * 60 * 24));
    
    if (totalDays < 1) totalDays = 1;

    // 3. Get room charges
    const trRequest2 = new sql.Request(transaction);
    const roomChargesResult = await trRequest2
      .input('room_type_id', sql.Int, roomTypeId)
      .query('SELECT per_day_charges FROM room_types WHERE room_type_id = @room_type_id');
    
    const dailyCharge = roomChargesResult.recordset[0]?.per_day_charges || 1000;
    const roomTotal = dailyCharge * totalDays;
    const medicalCharges = parseFloat(total_bill) - roomTotal;

    // Validate medical charges
    if (medicalCharges < 0) {
      await transaction.rollback();
      return res.status(400).json({ 
        error: 'Invalid total_bill amount. Room charges exceed total bill.',
        details: {
          room_charges: roomTotal,
          total_bill: total_bill,
          calculated_medical_charges: medicalCharges
        }
      });
    }

    // 4. Create discharge record
    const trRequest3 = new sql.Request(transaction);
    await trRequest3
      .input('admission_id', sql.Int, admissionId)
      .input('patient_id', sql.Int, patientId) // Use the validated patientId
      .input('doctor_id', sql.Int, doctorId) // Use the validated doctorId
      .input('total_days', sql.Int, totalDays)
      .input('room_charges', sql.Decimal(10, 2), roomTotal)
      .input('medical_charges', sql.Decimal(10, 2), medicalCharges)
      .input('total_amount', sql.Decimal(10, 2), parseFloat(total_bill))
      .input('amount_paid', sql.Decimal(10, 2), parseFloat(total_bill))
      .input('payment_status', sql.VarChar(50), 'Paid')
      .input('discharge_date', sql.DateTime, dischargeDate)
      .input('processed_by_receptionist_id', sql.Int, parseInt(discharged_by_receptionist_id, 10))
      .query(`
        INSERT INTO discharges (
          admission_id, patient_id, doctor_id, total_days,
          room_charges, medical_charges, total_amount,
          amount_paid, payment_status, discharge_date,
          processed_by_receptionist_id
        )
        VALUES (
          @admission_id, @patient_id, @doctor_id, @total_days,
          @room_charges, @medical_charges, @total_amount,
          @amount_paid, @payment_status, @discharge_date,
          @processed_by_receptionist_id
        )
      `);

    // 5. Update admission as inactive
    const trRequest4 = new sql.Request(transaction);
    await trRequest4
      .input('admission_id_2', sql.Int, admissionId)
      .query('UPDATE admissions SET is_active = 0, discharge_date = GETDATE() WHERE admission_id = @admission_id_2');

    // 6. Free up the bed
    const trRequest5 = new sql.Request(transaction);
    await trRequest5
      .input('bed_id', sql.Int, parseInt(bed_id, 10))
      .query('UPDATE beds SET is_occupied = 0 WHERE bed_id = @bed_id');

    // 7. Update room occupancy
    const trRequest6 = new sql.Request(transaction);
    await trRequest6
      .input('room_id', sql.Int, roomId)
      .query(`
        UPDATE rooms 
        SET is_occupied = CASE 
          WHEN EXISTS (SELECT 1 FROM beds WHERE room_id = @room_id AND is_occupied = 1) THEN 1
          ELSE 0
        END
        WHERE room_id = @room_id
      `);

    await transaction.commit();

    res.json({
      message: 'Patient discharged successfully',
      discharge_details: {
        admission_id: admissionId,
        total_days: totalDays,
        room_charges: roomTotal,
        medical_charges: medicalCharges,
        total_bill: total_bill,
        discharge_date: dischargeDate
      }
    });

  } catch (err) {
    console.error('❌ Error processing discharge:', err);
    
    if (transaction && transaction._acquiredConnection) {
      try {
        await transaction.rollback();
      } catch (rollbackErr) {
        console.error('❌ Error rolling back:', rollbackErr);
      }
    }
    
    res.status(500).json({ 
      error: 'Error processing discharge',
      details: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});
// 5. GET CONSULTATION ACTIONS FOR ADMISSION (ENHANCED VERSION - Missing gender/specialization)
// Replace your existing endpoint with this improved version
// DELETE the old one and use this instead:
app.get('/api/consultation-actions/admission-recommended', async (req, res) => {
  try {
    console.log('🔄 Fetching admission recommendations...');
    
    const result = await pool.request().query(`
      SELECT 
        ca.action_id,
        ca.consultation_id,
        ca.notes,
        ca.created_at,
        ca.status,
        at.action_name,
        
        -- Patient info
        c.patient_id,
        p.first_name AS patient_first_name,
        p.last_name AS patient_last_name,
        p.patient_login_id,
        p.gender AS patient_gender,
        p.age AS patient_age,
        p.blood_group,
        
        -- Doctor info
        c.doctor_id,
        d.first_name AS doctor_first_name,
        d.last_name AS doctor_last_name,
        d.doctor_login_id,
        d.specialization_id AS doctor_specialization_id,
        s.specialization_name AS doctor_specialization_name,
        d.consultation_fee,
        
        -- Consultation info
        c.appointment_id,
        c.diagnosis,
        FORMAT(c.consultation_date, 'yyyy-MM-dd HH:mm:ss') AS consultation_date
        
      FROM consultation_actions ca
      INNER JOIN action_types at ON ca.action_type_id = at.action_type_id
      INNER JOIN consultations c ON ca.consultation_id = c.consultation_id
      INNER JOIN patients p ON c.patient_id = p.patient_id
      INNER JOIN doctors d ON c.doctor_id = d.doctor_id
      INNER JOIN specializations s ON d.specialization_id = s.specialization_id
      WHERE at.action_name = 'Admit'
        AND ca.status = 'Pending'
        AND NOT EXISTS (
          SELECT 1 FROM admissions a 
          WHERE a.consultation_id = c.consultation_id 
          AND a.is_active = 1
        )
      ORDER BY ca.created_at DESC
    `);
    
    console.log(`✅ Found ${result.recordset.length} admission recommendations`);
    res.json(result.recordset);
  } catch (err) {
    console.error('❌ Error fetching admission recommendations:', err);
    res.status(500).json({ error: 'Error fetching admission recommendations' });
  }
});

// 6. GET ROOMS WITH DEPARTMENT INFO (Missing department extraction)
// Add this function to get rooms with department info
app.get('/api/rooms', async (req, res) => {
  try {
    const result = await pool.request().query(`
      SELECT 
        r.room_id,
        r.room_number,
        r.room_type_id,
        rt.type_name,
        rt.description,
        rt.per_day_charges,
        r.floor_number,
        r.is_occupied,
        
        -- Extract department from type_name
        CASE 
          WHEN rt.type_name LIKE '%CARD%' THEN 'Cardiology'
          WHEN rt.type_name LIKE '%ORTHO%' THEN 'Orthopedics'
          WHEN rt.type_name LIKE '%NEURO%' THEN 'Neurology'
          WHEN rt.type_name LIKE '%DERMA%' THEN 'Dermatology'
          WHEN rt.type_name LIKE '%PED%' THEN 'Pediatrics'
          ELSE 'General'
        END AS department_name
        
      FROM rooms r
      INNER JOIN room_types rt ON r.room_type_id = rt.room_type_id
      ORDER BY r.floor_number, r.room_number
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching rooms:', err);
    res.status(500).json({ error: 'Error fetching rooms' });
  }
});

// 7. GET ROOM TYPES WITH GENDER INFO (Missing gender extraction)
app.get('/api/room-types', async (req, res) => {
  try {
    const result = await pool.request().query(`
      SELECT 
        room_type_id,
        type_name,
        description,
        per_day_charges,
        
        -- Extract gender from type_name
        CASE 
          WHEN type_name LIKE '%-M' THEN 'Male'
          WHEN type_name LIKE '%-F' THEN 'Female'
          ELSE 'Mixed'
        END AS gender_category
        
      FROM room_types
      ORDER BY type_name
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching room types:', err);
    res.status(500).json({ error: 'Error fetching room types' });
  }
});

// 8. GET BEDS WITH OCCUPANCY STATUS (Enhanced version)
// Replace your existing /api/beds endpoint with this:
app.get('/api/beds', async (req, res) => {
  try {
    const result = await pool.request().query(`
      SELECT 
        b.bed_id,
        b.bed_code,
        b.room_id,
        b.bed_number,
        b.is_occupied,
        r.room_number,
        rt.type_name,
        rt.per_day_charges,
        r.floor_number,
        
        -- Patient info if occupied
        p.first_name AS patient_first_name,
        p.last_name AS patient_last_name,
        p.gender AS patient_gender
        
      FROM beds b
      INNER JOIN rooms r ON b.room_id = r.room_id
      INNER JOIN room_types rt ON r.room_type_id = rt.room_type_id
      LEFT JOIN admissions a ON b.bed_id = a.bed_id AND a.is_active = 1
      LEFT JOIN patients p ON a.patient_id = p.patient_id
      ORDER BY r.room_number, b.bed_number
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching beds:', err);
    res.status(500).json({ error: 'Error fetching beds' });
  }
});





//REPORTS
//-----------------------------------
//===================================================

// // 1. Daily Patient Report - FIXED
// app.get('/reports/daily-patients', async (req, res) => {
//     try {
//         const { date } = req.query;
//         const reportDate = date ? new Date(date) : new Date();
//         const dateStr = reportDate.toISOString().split('T')[0];
        
//         console.log('Generating daily patient report for date:', dateStr);
        
//         // Create SQL request with input parameters
//         const request = new sql.Request();
//         request.input('date', sql.Date, dateStr);
        
//         const query = `
//             SELECT 
//                 p.patient_id,
//                 p.patient_login_id,
//                 p.first_name + ' ' + p.last_name as patient_name,
//                 p.age,
//                 p.gender,
//                 p.blood_group,
//                 p.phone_no,
//                 p.created_at as registration_date,
//                 COUNT(DISTINCT a.appointment_id) as total_appointments,
//                 COUNT(DISTINCT CASE WHEN CAST(a.appointment_date AS DATE) = @date THEN a.appointment_id END) as appointments_today,
//                 COUNT(DISTINCT ad.admission_id) as total_admissions,
//                 COUNT(DISTINCT CASE WHEN CAST(ad.admission_date AS DATE) = @date THEN ad.admission_id END) as admissions_today
//             FROM patients p
//             LEFT JOIN appointments a ON p.patient_id = a.patient_id
//             LEFT JOIN admissions ad ON p.patient_id = ad.patient_id
//             WHERE CAST(p.created_at AS DATE) = @date
//                 OR CAST(a.appointment_date AS DATE) = @date
//                 OR CAST(ad.admission_date AS DATE) = @date
//             GROUP BY 
//                 p.patient_id, p.patient_login_id, p.first_name, p.last_name, 
//                 p.age, p.gender, p.blood_group, p.phone_no, p.created_at
//             ORDER BY p.created_at DESC
//         `;
        
//         console.log('Executing query:', query);
//         const result = await request.query(query);
        
//         console.log('Query successful, records found:', result.recordset.length);
        
//         const summary = {
//             total_patients: result.recordset.length,
//             new_patients: result.recordset.filter(p => 
//                 p.registration_date && 
//                 new Date(p.registration_date).toDateString() === reportDate.toDateString()
//             ).length,
//             appointments_today: result.recordset.reduce((sum, p) => sum + (p.appointments_today || 0), 0),
//             admissions_today: result.recordset.reduce((sum, p) => sum + (p.admissions_today || 0), 0),
//             date: dateStr
//         };
        
//         console.log('Report summary:', summary);
        
//         res.json({
//             summary,
//             data: result.recordset
//         });
//     } catch (error) {
//         console.error('❌ Error in daily-patients report:', error.message);
//         console.error('Stack trace:', error.stack);
//         res.status(500).json({ 
//             error: error.message,
//             details: 'Failed to generate daily patient report'
//         });
//     }
// });


//reports

//===============================================
//implement this accordingly
// 1. DAILY SUMMARY - All key stats in one API - SIMPLER VERSION
app.get('/reports/daily-summary', async (req, res) => {
    try {
        const { date } = req.query;
        const dateStr = date ? date : new Date().toISOString().split('T')[0];
        
        const request = new sql.Request();
        request.input('date', sql.Date, dateStr);
        
        const query = `
            SELECT 
                -- Today's new patients
                (SELECT COUNT(*) FROM patients WHERE CAST(created_at AS DATE) = @date) as new_patients,
                
                -- Today's appointments
                (SELECT COUNT(*) FROM appointments WHERE CAST(appointment_date AS DATE) = @date) as appointments,
                
                -- Today's consultations
                (SELECT COUNT(*) FROM consultations WHERE CAST(consultation_date AS DATE) = @date) as consultations,
                
                -- Today's admissions
                (SELECT COUNT(*) FROM admissions WHERE CAST(admission_date AS DATE) = @date) as admissions
        `;
        
        const result = await request.query(query);
        
        res.json({
            success: true,
            date: dateStr,
            data: result.recordset[0]
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
//implement this nowww
// // RANGE SUMMARY - Summary for a date range (simplified)
app.get('/reports/range-summary', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        
        // Default to last 30 days if no dates provided
        const defaultStartDate = new Date();
        defaultStartDate.setDate(defaultStartDate.getDate() - 30);
        
        const startDateStr = startDate || defaultStartDate.toISOString().split('T')[0];
        const endDateStr = endDate || new Date().toISOString().split('T')[0];
        
        const request = new sql.Request();
        request.input('startDate', sql.Date, startDateStr);
        request.input('endDate', sql.Date, endDateStr);
        
        const query = `
            SELECT 
                -- New patients in range
                (SELECT COUNT(*) FROM patients 
                 WHERE CAST(created_at AS DATE) BETWEEN @startDate AND @endDate) as new_patients,
                
                -- Appointments in range
                (SELECT COUNT(*) FROM appointments 
                 WHERE CAST(appointment_date AS DATE) BETWEEN @startDate AND @endDate) as appointments,
                
                -- Consultations in range
                (SELECT COUNT(*) FROM consultations 
                 WHERE CAST(consultation_date AS DATE) BETWEEN @startDate AND @endDate) as consultations,
                
                -- Admissions in range
                (SELECT COUNT(*) FROM admissions 
                 WHERE CAST(admission_date AS DATE) BETWEEN @startDate AND @endDate) as admissions
        `;
        
        const result = await request.query(query);
        
        res.json({
            success: true,
            startDate: startDateStr,
            endDate: endDateStr,
            data: result.recordset[0]
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
//working fine
// 2. TODAY'S APPOINTMENTS - Simple list
app.get('/reports/today-appointments', async (req, res) => {
    try {
        const dateStr = new Date().toISOString().split('T')[0];
        const request = new sql.Request();
        request.input('date', sql.Date, dateStr);
        
        const query = `
            SELECT 
                a.appointment_id,
                p.patient_login_id,
                CONCAT(p.first_name, ' ', p.last_name) as patient_name,
                CONCAT('Dr. ', d.first_name, ' ', d.last_name) as doctor_name,
                ast.status_name
            FROM appointments a
            JOIN patients p ON a.patient_id = p.patient_id
            JOIN doctors d ON a.doctor_id = d.doctor_id
            JOIN appointment_statuses ast ON a.status_id = ast.status_id
            WHERE CAST(a.appointment_date AS DATE) = @date
            ORDER BY a.appointment_date
        `;
        
        const result = await request.query(query);
        
        res.json({
            success: true,
            date: dateStr,
            total: result.recordset.length,
            data: result.recordset
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

//working fine
// 3. ACTIVE ADMISSIONS - Current patients in hospital
app.get('/reports/active-admissions', async (req, res) => {
    try {
        const request = new sql.Request();
        
        const query = `
            SELECT 
                ad.admission_id,
                p.patient_login_id,
                CONCAT(p.first_name, ' ', p.last_name) as patient_name,
                CONCAT('Dr. ', d.first_name, ' ', d.last_name) as doctor_name,
                FORMAT(ad.admission_date, 'yyyy-MM-dd') as admission_date
            FROM admissions ad
            JOIN patients p ON ad.patient_id = p.patient_id
            JOIN doctors d ON ad.doctor_id = d.doctor_id
            WHERE ad.is_active = 1
            ORDER BY ad.admission_date DESC
        `;
        
        const result = await request.query(query);
        
        res.json({
            success: true,
            total: result.recordset.length,
            data: result.recordset
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

//implement this
// 4. RECENT DISCHARGES - Last 30 discharges (Corrected for your schema)
app.get('/reports/recent-discharges', async (req, res) => {
    try {
        const request = new sql.Request();
        
        const query = `
            SELECT TOP 30
                d.discharge_id,
                p.patient_login_id,
                CONCAT(p.first_name, ' ', p.last_name) as patient_name,
                FORMAT(d.discharge_date, 'yyyy-MM-dd') as discharge_date,
                d.total_days,
                d.total_amount,
                d.payment_status,
                d.amount_paid,
                
                -- Room and medical charges breakdown
                d.room_charges,
                d.medical_charges,
                d.doctor_visit_charges,
                d.lab_charges,
                d.other_charges,
                
                -- Doctor information
                CONCAT('Dr. ', doc.first_name, ' ', doc.last_name) as doctor_name,
                s.specialization_name,
                
                -- Admission information
                FORMAT(a.admission_date, 'yyyy-MM-dd') as admission_date,
                
                -- Receptionist who processed
                r.receptionist_login_id as processed_by,
                
                -- Additional discharge info
                d.final_diagnosis,
                d.follow_up_required,
                FORMAT(d.follow_up_date, 'yyyy-MM-dd') as follow_up_date,
                
                -- Calculate balance
                (d.total_amount - d.amount_paid) as balance_due
                
            FROM discharges d
            JOIN patients p ON d.patient_id = p.patient_id
            JOIN admissions a ON d.admission_id = a.admission_id
            JOIN doctors doc ON d.doctor_id = doc.doctor_id
            JOIN specializations s ON doc.specialization_id = s.specialization_id
            JOIN receptionists r ON d.processed_by_receptionist_id = r.receptionist_id
            ORDER BY d.discharge_date DESC
        `;
        
        const result = await request.query(query);
        
        res.json({
            success: true,
            total: result.recordset.length,
            data: result.recordset
        });
    } catch (error) {
        console.error('Error in recent-discharges API:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message
        });
    }
});
//yes working fine
// 5. RECENT SIGN-INS - Last 20 logins
app.get('/reports/recent-signins', async (req, res) => {
    try {
        const request = new sql.Request();
        
        const query = `
            SELECT TOP 20
                user_id,
                user_type,
                FORMAT(signin_datetime, 'yyyy-MM-dd HH:mm') as signin_time
            FROM signin_logs
            ORDER BY signin_datetime DESC
        `;
        
        const result = await request.query(query);
        
        res.json({
            success: true,
            total: result.recordset.length,
            data: result.recordset
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
//yes working fine
// 6. DOCTOR LIST - All doctors with basic info
app.get('/reports/doctors-list', async (req, res) => {
    try {
        const request = new sql.Request();
        
        const query = `
            SELECT 
                d.doctor_id,
                d.doctor_login_id,
                CONCAT(d.first_name, ' ', d.last_name) as doctor_name,
                s.specialization_name,
                d.consultation_fee
            FROM doctors d
            JOIN specializations s ON d.specialization_id = s.specialization_id
            ORDER BY d.first_name
        `;
        
        const result = await request.query(query);
        
        res.json({
            success: true,
            total: result.recordset.length,
            data: result.recordset
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
//fine working
// 7. RECENT PATIENTS - Last 50 registered patients  it should get data from signups
app.get('/reports/recent-patients', async (req, res) => {
    try {
        const request = new sql.Request();
        
        const query = `
            SELECT TOP 50
                patient_id,
                patient_login_id,
                CONCAT(first_name, ' ', last_name) as patient_name,
                age,
                gender,
                FORMAT(created_at, 'yyyy-MM-dd') as registered_date
            FROM patients
            ORDER BY created_at DESC
        `;
        
        const result = await request.query(query);
        
        res.json({
            success: true,
            total: result.recordset.length,
            data: result.recordset
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// GET ALL ROOMS
app.get('/api/rooms', async (req, res) => {
    try {
        const result = await pool.request().query(`
            SELECT r.*, rt.type_name, rt.per_day_charges
            FROM rooms r
            INNER JOIN room_types rt ON r.room_type_id = rt.room_type_id
            ORDER BY r.floor_number, r.room_number
        `);
        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching rooms:', err);
        res.status(500).json({ error: 'Error fetching rooms' });
    }
});

// GET AVAILABLE ROOMS (not currently assigned to active admissions)
app.get('/api/rooms/available', async (req, res) => {
    try {
        const { room_type_id } = req.query;
        
        let query = `
            SELECT r.*, rt.type_name, rt.per_day_charges
            FROM rooms r
            INNER JOIN room_types rt ON r.room_type_id = rt.room_type_id
            WHERE r.room_id NOT IN (
                SELECT initial_room_id FROM admissions WHERE is_active = 1
            )
        `;
        
        const request = pool.request();
        
        if (room_type_id) {
            query += ' AND r.room_type_id = @room_type_id';
            request.input('room_type_id', sql.Int, room_type_id);
        }
        
        query += ' ORDER BY r.floor_number, r.room_number';
        
        const result = await request.query(query);
        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching available rooms:', err);
        res.status(500).json({ error: 'Error fetching available rooms' });
    }
});

// GET ROOM TYPES
app.get('/api/room-types', async (req, res) => {
    try {
        const result = await pool.request().query(`
            SELECT * FROM room_types ORDER BY type_name
        `);
        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching room types:', err);
        res.status(500).json({ error: 'Error fetching room types' });
    }
});


// ============================================
// CREATE ADMISSION - FINAL CORRECTED VERSION (REPLACED ORIGINAL)
// ============================================
app.post('/api/admissions', async (req, res) => {
    console.log('🚀 POST /api/admissions called');
    
    let transaction;
    
    try {
        const {
            patient_id,
            doctor_id,
            consultation_id,
            action_id,
            initial_room_id,
            bed_id, // This is the mandatory ID from the client
            admission_notes,
            assigned_by_receptionist_id
        } = req.body;

        // 0. Validate all required fields including bed_id
        if (!patient_id || !doctor_id || !consultation_id || !action_id || 
            !initial_room_id || !bed_id || !assigned_by_receptionist_id) {
            console.log('❌ Missing required fields in request body.');
            return res.status(400).json({ 
                error: 'All required fields must be provided (patient_id, doctor_id, consultation_id, action_id, initial_room_id, bed_id, assigned_by_receptionist_id)'
            });
        }

        // Start transaction
        transaction = pool.transaction();
        await transaction.begin();

        // --- STEP 1: Bed Check (Use trRequest1) ---
        let trRequest1 = transaction.request();
        const bedCheck = await trRequest1
            .input('bedIdCheck', sql.Int, bed_id) 
            .query('SELECT is_occupied, room_id FROM beds WHERE bed_id = @bedIdCheck');

        if (bedCheck.recordset.length === 0) {
            await transaction.rollback();
            return res.status(404).json({ error: 'Bed not found' });
        }
        if (bedCheck.recordset[0].is_occupied) {
            await transaction.rollback();
            return res.status(409).json({ error: 'Bed is already occupied' });
        }
        const room_id = bedCheck.recordset[0].room_id;


        // --- STEP 2: Create Admission (Use trRequest2) ---
        let trRequest2 = transaction.request();
        const admissionResult = await trRequest2
            .input('patient_id', sql.Int, patient_id)
            .input('doctor_id', sql.Int, doctor_id)
            .input('consultation_id', sql.Int, consultation_id)
            .input('action_id', sql.Int, action_id)
            .input('initial_room_id', sql.Int, initial_room_id)
            .input('bed_id_insert', sql.Int, bed_id) // Use unique name for INSERT
            .input('admission_notes', sql.VarChar, admission_notes || null)
            .input('assigned_by_receptionist_id', sql.Int, assigned_by_receptionist_id)
            .query(`
                INSERT INTO admissions (
                    patient_id, doctor_id, consultation_id, action_id,
                    initial_room_id, bed_id, admission_notes,
                    assigned_by_receptionist_id, admission_date, is_active
                )
                OUTPUT INSERTED.admission_id, INSERTED.bed_id, INSERTED.admission_date
                VALUES (
                    @patient_id, @doctor_id, @consultation_id, @action_id,
                    @initial_room_id, @bed_id_insert, @admission_notes,
                    @assigned_by_receptionist_id, GETDATE(), 1
                )
            `);

        const admission = admissionResult.recordset[0];
        console.log(`✅ Admission created: ID=${admission.admission_id}, bed_id=${admission.bed_id}`);


        // --- STEP 3: Update Consultation Action Status (Use trRequest3) ---
        let trRequest3 = transaction.request();
        await trRequest3
            .input('actionIdUpdate', sql.Int, action_id)
            .query(`
                UPDATE consultation_actions 
                SET status = 'Completed', completed_at = GETDATE()
                WHERE action_id = @actionIdUpdate
            `);


        // --- STEP 4: Update Bed Status (Use trRequest4) ---
        let trRequest4 = transaction.request();
        await trRequest4
            .input('bedIdUpdate', sql.Int, bed_id)
            .query('UPDATE beds SET is_occupied = 1 WHERE bed_id = @bedIdUpdate');


        // --- STEP 5: Update Room Occupancy (Use trRequest5) ---
        let trRequest5 = transaction.request();
        await trRequest5
            .input('roomIdUpdate', sql.Int, room_id)
            .query(`
                UPDATE rooms 
                SET is_occupied = 1 
                WHERE room_id = @roomIdUpdate 
                AND NOT EXISTS (
                    SELECT 1 FROM beds 
                    WHERE room_id = @roomIdUpdate 
                    AND is_occupied = 0
                )
            `);

        await transaction.commit();
        console.log('✅ Transaction committed successfully');

        // 6. Get full admission details for response (using the main pool connection)
        const detailsResult = await pool.request()
            .input('admission_id', sql.Int, admission.admission_id)
            .query(`
                SELECT 
                    a.*,
                    CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
                    CONCAT(d.first_name, ' ', d.last_name) AS doctor_name,
                    r.room_number,
                    b.bed_number,
                    b.bed_code,
                    rt.type_name AS room_type
                FROM admissions a
                INNER JOIN patients p ON a.patient_id = p.patient_id
                INNER JOIN doctors d ON a.doctor_id = d.doctor_id
                INNER JOIN rooms r ON a.initial_room_id = r.room_id
                INNER JOIN beds b ON a.bed_id = b.bed_id
                INNER JOIN room_types rt ON r.room_type_id = rt.room_type_id
                WHERE a.admission_id = @admission_id
            `);

        res.status(201).json({
            message: 'Patient admitted successfully',
            admission: detailsResult.recordset[0]
        });

    } catch (err) {
        console.error('❌ Error in /api/admissions:', err);
        console.error('Error details:', err.message);
        
        if (transaction && transaction._acquiredConnection) {
            try {
                await transaction.rollback();
                console.log('🔄 Transaction rolled back');
            } catch (rollbackErr) {
                console.error('❌ Error rolling back:', rollbackErr);
            }
        }
        
        res.status(500).json({ 
            error: 'Error creating admission',
            message: err.message,
            code: err.code,
            number: err.number
        });
    }
});

// GET ALL ACTIVE ADMISSIONS
app.get('/api/admissions/active', async (req, res) => {
    try {
        const result = await pool.request().query(`
            SELECT a.*,
                CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
                p.age, p.gender, p.blood_group,
                CONCAT(d.first_name, ' ', d.last_name) AS doctor_name,
                r.room_number, rt.type_name AS room_type,
                CONCAT(rec.first_name, ' ', rec.last_name) AS receptionist_name,
                DATEDIFF(DAY, a.admission_date, GETDATE()) AS days_admitted
            FROM admissions a
            INNER JOIN patients p ON a.patient_id = p.patient_id
            INNER JOIN doctors d ON a.doctor_id = d.doctor_id
            INNER JOIN rooms r ON a.initial_room_id = r.room_id
            INNER JOIN room_types rt ON r.room_type_id = rt.room_type_id
            INNER JOIN receptionists rec ON a.assigned_by_receptionist_id = rec.receptionist_id
            WHERE a.is_active = 1
            ORDER BY a.admission_date DESC
        `);

        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching active admissions:', err);
        res.status(500).json({ error: 'Error fetching active admissions' });
    }
});

// GET ADMISSION BY ID
app.get('/api/admissions/:id', async (req, res) => {
    try {
        const admissionId = parseInt(req.params.id, 10);
        
        const result = await pool.request()
            .input('admission_id', sql.Int, admissionId)
            .query(`
                SELECT a.*,
                    CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
                    p.age, p.gender, p.blood_group, p.phone_no,
                    CONCAT(d.first_name, ' ', d.last_name) AS doctor_name,
                    r.room_number, rt.type_name AS room_type, rt.per_day_charges,
                    CONCAT(rec.first_name, ' ', rec.last_name) AS receptionist_name,
                    DATEDIFF(DAY, a.admission_date, COALESCE(a.discharge_date, GETDATE())) AS total_days
                FROM admissions a
                INNER JOIN patients p ON a.patient_id = p.patient_id
                INNER JOIN doctors d ON a.doctor_id = d.doctor_id
                INNER JOIN rooms r ON a.initial_room_id = r.room_id
                INNER JOIN room_types rt ON r.room_type_id = rt.room_type_id
                INNER JOIN receptionists rec ON a.assigned_by_receptionist_id = rec.receptionist_id
                WHERE a.admission_id = @admission_id
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({ error: 'Admission not found' });
        }

        res.json(result.recordset[0]);
    } catch (err) {
        console.error('Error fetching admission:', err);
        res.status(500).json({ error: 'Error fetching admission' });
    }
});



//staring the server
const PORT = process.env.PORT || 3000;

initializeDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
});


